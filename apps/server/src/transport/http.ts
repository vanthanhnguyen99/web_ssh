import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import type { WorkspaceService } from "../application/workspaces.js";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import {
  idSchema,
  sessionProfileSchema,
  broadcastActivationSchema,
  loginSchema,
  createSessionSchema,
  sessionDtoSchema,
  profileInputSchema,
  profileSchema,
  credentialInputSchema,
  credentialDtoSchema,
  preferencesSchema,
  trustImportSchema,
  trustSchema,
  sessionWorkspaceSchema,
  folderInputSchema,
  folderSchema,
  workspaceInputSchema,
  workspaceSchema,
  workspaceRestoreSchema,
  groupLaunchSchema,
} from "@workspace/shared";
import { DomainError, publicError } from "../domain/errors.js";
import type { Principal } from "../domain/ports.js";
import type { CatalogService } from "../application/catalog.js";
import type { AuthService } from "../application/auth.js";
import type { SshSessionService } from "../application/sessions.js";
import { registerSockets } from "./socket.js";
export interface AppDependencies {
  logStream?: { write(message: string): void };
  auth: AuthService;
  sessions: SshSessionService;
  catalog: CatalogService;
  workspaces: WorkspaceService;
  metrics(): Record<string, unknown>;
  config: {
    origin: string;
    secureCookie: boolean;
    webSessionMs: number;
    webDirectory?: string;
  };
  readiness(): Promise<void>;
}
declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}
export async function createApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: {
      level: dependencies.logStream
        ? "info"
        : process.env.NODE_ENV === "test"
          ? "silent"
          : "info",
      ...(dependencies.logStream ? { stream: dependencies.logStream } : {}),
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'req.headers["x-csrf-token"]',
          "password",
          "privateKey",
          "passphrase",
          "credential",
          "material",
          "token",
          "*.password",
          "*.privateKey",
          "*.passphrase",
          "*.credential",
          "*.material",
          "*.token",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 131072,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: dependencies.config.secureCookie,
  });
  app.decorateRequest("principal");
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/")) return;
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutation && request.headers.origin !== dependencies.config.origin)
      throw new DomainError("FORBIDDEN", "Invalid request origin", 403);
    if (request.url.split("?")[0] === "/api/auth/login") return;
    request.principal = await dependencies.auth.authenticate(
      request.cookies.sid,
    );
    if (mutation)
      dependencies.auth.csrf(
        request.principal,
        typeof request.headers["x-csrf-token"] === "string"
          ? request.headers["x-csrf-token"]
          : undefined,
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
        },
      });
    if (error instanceof DomainError)
      return reply.code(error.status).send({ error: error.toJSON() });
    app.log.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Request failed",
    );
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    return reply.code(status).send({
      error:
        status < 500
          ? {
              code: "INVALID_REQUEST",
              message:
                status === 413
                  ? "Request exceeds size limit"
                  : "Invalid request body",
            }
          : publicError(error),
    });
  });
  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await dependencies.auth.login(
      input.username,
      input.password,
      request.ip,
    );
    reply.setCookie("sid", result.token, {
      path: "/",
      secure: dependencies.config.secureCookie,
      httpOnly: true,
      sameSite: "strict",
      maxAge: Math.floor(dependencies.config.webSessionMs / 1000),
    });
    return { user: result.user, csrfToken: result.csrfToken };
  });
  app.get("/api/me", (request) => ({
    user: request.principal.user,
    csrfToken: request.principal.csrfToken,
  }));
  app.post("/api/auth/logout", async (request, reply) => {
    await dependencies.auth.logout(request.principal);
    reply.clearCookie("sid", {
      path: "/",
      secure: dependencies.config.secureCookie,
      httpOnly: true,
      sameSite: "strict",
    });
    return { ok: true };
  });
  app.post("/api/broadcast", async (request) => {
    const input = broadcastActivationSchema.parse(request.body);
    return dependencies.sessions.auditBroadcast(
      request.principal,
      input.enabled,
      input.sessionIds,
    );
  });
  app.get("/api/sessions", (request) =>
    dependencies.sessions.manager
      .list(request.principal.user.id)
      .map((value) => sessionDtoSchema.parse(value)),
  );
  app.post("/api/sessions", async (request, reply) => {
    const result = await dependencies.sessions.create(
      request.principal,
      createSessionSchema.parse(request.body),
    );
    return reply.code(201).send(sessionDtoSchema.parse(result));
  });
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/profile-draft",
    async (request) =>
      profileInputSchema.parse(
        await dependencies.sessions.profileDraft(
          request.principal,
          idSchema.parse(request.params.id),
        ),
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/profile",
    async (request) => {
      const input = sessionProfileSchema.parse(request.body);
      return sessionDtoSchema.parse(
        await dependencies.sessions.promoteProfile(
          request.principal,
          idSchema.parse(request.params.id),
          input.profileId,
        ),
      );
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/sessions/:id/workspace",
    async (request) => {
      const input = sessionWorkspaceSchema.parse(request.body);
      return sessionDtoSchema.parse(
        await dependencies.sessions.associateWorkspace(
          request.principal,
          idSchema.parse(request.params.id),
          input.workspaceId,
          input.workspaceEntryId,
        ),
      );
    },
  );
  app.delete<{ Params: { id: string } }>("/api/sessions/:id", (request) => {
    dependencies.sessions.manager.close(
      request.principal,
      idSchema.parse(request.params.id),
    );
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/reconnect",
    async (request, reply) =>
      reply
        .code(201)
        .send(
          sessionDtoSchema.parse(
            await dependencies.sessions.reconnect(
              request.principal,
              idSchema.parse(request.params.id),
            ),
          ),
        ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/duplicate",
    async (request, reply) =>
      reply
        .code(201)
        .send(
          sessionDtoSchema.parse(
            await dependencies.sessions.duplicate(
              request.principal,
              idSchema.parse(request.params.id),
            ),
          ),
        ),
  );
  app.get("/api/profiles", async (request) =>
    (await dependencies.catalog.profiles(request.principal)).map((p) =>
      profileSchema.parse(p),
    ),
  );
  app.post("/api/profiles", async (request, reply) =>
    reply
      .code(201)
      .send(
        profileSchema.parse(
          await dependencies.catalog.putProfile(
            request.principal,
            profileInputSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.put<{ Params: { id: string } }>("/api/profiles/:id", async (request) =>
    profileSchema.parse(
      await dependencies.catalog.putProfile(
        request.principal,
        profileInputSchema.parse(request.body),
        idSchema.parse(request.params.id),
      ),
    ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/profiles/:id",
    async (request) => {
      await dependencies.catalog.deleteProfile(
        request.principal,
        idSchema.parse(request.params.id),
      );
      return { ok: true };
    },
  );
  app.get("/api/folders", async (request) =>
    (await dependencies.catalog.folders(request.principal)).map((f) =>
      folderSchema.parse(f),
    ),
  );
  app.post("/api/folders", async (request, reply) =>
    reply
      .code(201)
      .send(
        folderSchema.parse(
          await dependencies.catalog.putFolder(
            request.principal,
            folderInputSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.put<{ Params: { id: string } }>("/api/folders/:id", async (request) =>
    folderSchema.parse(
      await dependencies.catalog.putFolder(
        request.principal,
        folderInputSchema.parse(request.body),
        idSchema.parse(request.params.id),
      ),
    ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/folders/:id",
    async (request) => {
      await dependencies.catalog.deleteFolder(
        request.principal,
        idSchema.parse(request.params.id),
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/folders/:id/launch",
    async (request) =>
      groupLaunchSchema.parse(
        await dependencies.workspaces.launchFolder(
          request.principal,
          idSchema.parse(request.params.id),
        ),
      ),
  );
  app.get("/api/workspaces", async (request) =>
    (await dependencies.catalog.workspaces(request.principal)).map((w) =>
      workspaceSchema.parse(w),
    ),
  );
  app.post("/api/workspaces", async (request, reply) =>
    reply
      .code(201)
      .send(
        workspaceSchema.parse(
          await dependencies.catalog.putWorkspace(
            request.principal,
            workspaceInputSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.put<{ Params: { id: string } }>("/api/workspaces/:id", async (request) =>
    workspaceSchema.parse(
      await dependencies.catalog.putWorkspace(
        request.principal,
        workspaceInputSchema.parse(request.body),
        idSchema.parse(request.params.id),
      ),
    ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/workspaces/:id",
    async (request) => {
      await dependencies.catalog.deleteWorkspace(
        request.principal,
        idSchema.parse(request.params.id),
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/restore",
    async (request) =>
      workspaceRestoreSchema.parse(
        await dependencies.workspaces.restore(
          request.principal,
          idSchema.parse(request.params.id),
        ),
      ),
  );
  app.get("/api/credentials", async (request) =>
    (await dependencies.catalog.listCredentials(request.principal)).map((c) =>
      credentialDtoSchema.parse(c),
    ),
  );
  app.post("/api/credentials", async (request, reply) =>
    reply
      .code(201)
      .send(
        credentialDtoSchema.parse(
          await dependencies.catalog.putCredential(
            request.principal,
            credentialInputSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.put<{ Params: { id: string } }>("/api/credentials/:id", async (request) =>
    credentialDtoSchema.parse(
      await dependencies.catalog.putCredential(
        request.principal,
        credentialInputSchema.parse(request.body),
        idSchema.parse(request.params.id),
      ),
    ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/credentials/:id",
    async (request) => {
      await dependencies.catalog.deleteCredential(
        request.principal,
        idSchema.parse(request.params.id),
      );
      return { ok: true };
    },
  );
  app.get("/api/preferences", async (request) =>
    preferencesSchema.parse(
      await dependencies.catalog.preferences(request.principal),
    ),
  );
  app.put("/api/preferences", async (request) =>
    preferencesSchema.parse(
      await dependencies.catalog.putPreferences(
        request.principal,
        preferencesSchema.parse(request.body),
      ),
    ),
  );
  app.post("/api/host-keys", async (request, reply) =>
    reply
      .code(201)
      .send(
        trustSchema.parse(
          await dependencies.sessions.trust.import(
            request.principal.user.id,
            trustImportSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.get("/api/host-keys", (request) =>
    dependencies.sessions.trust.list(request.principal.user.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/host-keys/:id",
    async (request) => {
      await dependencies.sessions.trust.remove(
        request.principal.user.id,
        idSchema.parse(request.params.id),
      );
      return { ok: true };
    },
  );
  app.get("/health/live", () => ({ ok: true }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await dependencies.readiness();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get("/api/metrics", (request) => {
    if (request.principal.user.role !== "admin")
      throw new DomainError("FORBIDDEN", "Administrator required", 403);
    return dependencies.metrics();
  });
  if (
    dependencies.config.webDirectory &&
    existsSync(dependencies.config.webDirectory)
  ) {
    await app.register(staticFiles, { root: dependencies.config.webDirectory });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply
            .code(404)
            .send({ error: { code: "NOT_FOUND", message: "Route not found" } })
        : reply.sendFile("index.html"),
    );
  }
  const io = registerSockets(app, dependencies);
  app.addHook("onClose", async () => {
    dependencies.sessions.manager.shutdown();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return app;
}
