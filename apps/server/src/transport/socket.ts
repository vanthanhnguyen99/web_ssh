import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { ZodError, type ZodType } from "zod";
import {
  attachSchema,
  authResponseSchema,
  hostKeyDecisionSchema,
  inputSchema,
  resizeSchema,
  sessionIdSchema,
  type SocketReply,
} from "@workspace/shared";
import { DomainError, publicError } from "../domain/errors.js";
import type { AppDependencies } from "./http.js";
export function registerSockets(
  app: FastifyInstance,
  dependencies: AppDependencies,
) {
  const io = new Server(app.server, {
    maxHttpBufferSize: 131072,
    transports: ["websocket"],
    perMessageDeflate: false,
    allowRequest: (request, callback) =>
      callback(null, request.headers.origin === dependencies.config.origin),
  });
  io.use(async (socket, next) => {
    try {
      const token = app.parseCookie(socket.request.headers.cookie ?? "").sid;
      const principal = await dependencies.auth.authenticate(token);
      dependencies.auth.csrf(principal, socket.handshake.auth.csrfToken);
      socket.data.token = token;
      socket.data.expiresAt = principal.expiresAt;
      next();
    } catch (error) {
      const failure = publicError(error);
      next(
        Object.assign(new Error("Unauthorized socket connection"), {
          data: failure,
        }),
      );
    }
  });
  io.on("connection", (socket) => {
    const expiry = setTimeout(
      () => {
        socket.emit("auth:invalidated", {
          code: "SESSION_EXPIRED",
          message: "Web session expired; sign in again",
        });
        socket.disconnect(true);
      },
      Math.max(1, socket.data.expiresAt - Date.now()),
    );
    expiry.unref();
    let queued = 0;
    let queuedFrames = 0;
    let replayPending = false;
    let queuedEvents = 0;
    let queuedEventBytes = 0;
    let serial: Promise<void> = Promise.resolve();
    let eventWindow = Date.now();
    let eventCount = 0;
    function sendAcknowledged(event: string, data: unknown, bytes: number) {
      queued += bytes;
      queuedFrames++;
      if (queued > 262144 || queuedFrames > 512) {
        socket.disconnect(true);
        return;
      }
      socket.timeout(3000).emit(event, data, (error: Error | null) => {
        queued = Math.max(0, queued - bytes);
        queuedFrames = Math.max(0, queuedFrames - 1);
        if (error) socket.disconnect(true);
      });
    }
    const sink = {
      state: (data: unknown) => socket.emit("session:state", data),
      output: (data: { data: Uint8Array }) =>
        sendAcknowledged("terminal:data", data, data.data.byteLength),
      prompt: (event: string, data: unknown) => socket.emit(event, data),
      replaced: (sessionId: string) =>
        socket.emit("session:replaced", { sessionId }),
    };
    function handle<T>(
      event: string,
      schema: ZodType<T>,
      action: (
        input: T,
        principal: Awaited<ReturnType<typeof dependencies.auth.authenticate>>,
      ) => unknown | Promise<unknown>,
    ) {
      socket.on(
        event,
        (raw: unknown, ack?: (value: SocketReply<unknown>) => void) => {
          const fail = (error: unknown, invalidAuthentication = false) => {
            const apiError =
              error instanceof ZodError
                ? {
                    code: "INVALID_REQUEST" as const,
                    message: "Invalid socket payload",
                  }
                : publicError(error);
            if (typeof ack === "function") ack({ ok: false, error: apiError });
            if (
              invalidAuthentication &&
              ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(apiError.code)
            ) {
              socket.emit("auth:invalidated", apiError);
              socket.disconnect(true);
            }
          };
          let input: T;
          let bytes: number;
          try {
            const now = Date.now();
            if (now - eventWindow >= 1000) {
              eventWindow = now;
              eventCount = 0;
            }
            input = schema.parse(raw);
            bytes = Buffer.byteLength(JSON.stringify(raw));
            if (
              ++eventCount > 500 ||
              queuedEvents >= 128 ||
              queuedEventBytes + bytes > 1048576
            ) {
              socket.disconnect(true);
              throw new DomainError(
                "RATE_LIMITED",
                "Socket event queue limit reached",
                429,
              );
            }
          } catch (error) {
            fail(error);
            return;
          }
          queuedEvents++;
          queuedEventBytes += bytes;
          // Authenticate and act in arrival order: concurrent database lookups must not reorder keystrokes.
          serial = serial.then(async () => {
            let authenticated = false;
            try {
              if (!socket.connected)
                throw new DomainError(
                  "UNAUTHORIZED",
                  "Disconnected input was discarded",
                  401,
                );
              const principal = await dependencies.auth.authenticate(
                socket.data.token,
              );
              authenticated = true;
              if (!socket.connected)
                throw new DomainError(
                  "UNAUTHORIZED",
                  "Disconnected input was discarded",
                  401,
                );
              await action(input, principal);
              if (typeof ack === "function") ack({ ok: true });
            } catch (error) {
              fail(
                error,
                !authenticated || socket.data.expiresAt <= Date.now(),
              );
            } finally {
              queuedEvents--;
              queuedEventBytes -= bytes;
            }
          });
        },
      );
    }

    handle("session:attach", attachSchema, async (input, principal) => {
      if (replayPending)
        throw new DomainError("RATE_LIMITED", "Replay is already pending", 429);
      const replay = dependencies.sessions.manager.attach(
        principal,
        input.sessionId,
        socket.id,
        sink,
        input.afterSequence,
      );
      // Socket.IO's decoder caps binary attachments. A retained ring can contain
      // thousands of frames, so encode replay as one bounded binary attachment.
      // Its final sequence acknowledges all preceding retained bytes in order.
      const wireReplay = {
        ...replay,
        frames: replay.frames.length
          ? [
              {
                sessionId: replay.sessionId,
                sequence: replay.frames[replay.frames.length - 1]!.sequence,
                data: Buffer.concat(
                  replay.frames.map((frame) => Buffer.from(frame.data)),
                ),
              },
            ]
          : [],
      };
      replayPending = true; // At most one bounded replay per socket can be queued.
      await new Promise<void>((resolve, reject) => {
        socket
          .timeout(5000)
          .emit("session:replay", wireReplay, (error: Error | null) => {
            replayPending = false;
            if (error) {
              socket.disconnect(true);
              reject(
                new DomainError(
                  "SLOW_CONSUMER",
                  "Terminal replay was not acknowledged",
                ),
              );
            } else resolve();
          });
      });
    });
    handle("session:detach", sessionIdSchema, (input, principal) =>
      dependencies.sessions.manager.detach(
        principal,
        input.sessionId,
        socket.id,
      ),
    );
    handle("terminal:input", inputSchema, (input, principal) =>
      dependencies.sessions.manager.input(
        principal,
        input.sessionId,
        socket.id,
        input.data,
      ),
    );
    handle("terminal:resize", resizeSchema, (input, principal) =>
      dependencies.sessions.manager.resize(
        principal,
        input.sessionId,
        socket.id,
        input.columns,
        input.rows,
      ),
    );
    handle("hostkey:decision", hostKeyDecisionSchema, (input, principal) =>
      dependencies.sessions.manager.respond(
        principal,
        input.sessionId,
        socket.id,
        input.requestId,
        "hostkey:request",
        { accept: input.accept, save: input.save },
      ),
    );
    handle("auth:response", authResponseSchema, (input, principal) =>
      dependencies.sessions.manager.respond(
        principal,
        input.sessionId,
        socket.id,
        input.requestId,
        "auth:request",
        input.credential,
      ),
    );
    handle("session:close", sessionIdSchema, (input, principal) =>
      dependencies.sessions.manager.close(principal, input.sessionId),
    );
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      dependencies.sessions.manager.detachController(socket.id);
    });
  });
  return io;
}
