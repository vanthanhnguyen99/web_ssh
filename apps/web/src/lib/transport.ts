import { io, type Socket } from "socket.io-client";
import type {
  AuthRequest,
  HostKeyRequest,
  OutputFrame,
  Replay,
  SessionDto,
  SocketReply,
} from "@workspace/shared";
import {
  sessionDtoSchema,
  authRequestSchema,
  hostKeyRequestSchema,
  apiErrorSchema,
} from "@workspace/shared";
import { getCsrfToken, api } from "./api";
import { useWorkspace } from "./store";
import { terminalFor } from "./terminals";
import { inputController } from "./input";
import { currentOperation } from "./operation";
import { applyWorkspaceLayout } from "./workspaces";
import { useCatalog } from "./catalog";
import {
  invalidateAuthentication,
  isAuthenticationError,
} from "./authLifecycle";
let connection: Socket | null = null;
let removeNetworkListeners: (() => void) | null = null;
export function emit(event: string, payload: unknown): Promise<void> {
  const socket = connection;
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("Browser is disconnected; input was discarded"));
      return;
    }
    socket
      .timeout(5000)
      .emit(event, payload, (error: Error | null, reply: SocketReply) => {
        if (error) reject(new Error("Server response timed out"));
        else if (!reply.ok) {
          reject(new Error(reply.error.message));
        } else resolve();
      });
  });
}
export function connectTransport() {
  disconnectTransport();
  const socket = io({
    transports: ["websocket"],
    autoConnect: navigator.onLine !== false,
    auth: { csrfToken: getCsrfToken() },
    reconnection: true,
  });
  connection = socket;
  inputController.bind(socket);
  const offline = () => {
    if (connection !== socket) return;
    socket.sendBuffer = [];
    socket.disconnect();
    inputController.bind(socket);
    useWorkspace.setState({
      online: false,
      attached: [],
      hostRequests: [],
      authRequests: [],
      multiExec: false,
      selectedIds: [],
    });
  };
  const online = () => {
    if (connection === socket && getCsrfToken()) socket.connect();
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  removeNetworkListeners = () => {
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
  };
  socket.on("connect", async () => {
    if (connection !== socket) return;
    const current = currentOperation();
    useWorkspace.setState({ online: true, hostRequests: [], authRequests: [] });
    try {
      const sessions = await api("/sessions", {}, sessionDtoSchema.array());
      if (connection !== socket || !socket.connected || !current()) return;
      for (const session of sessions) {
        if (connection !== socket || !socket.connected || !current()) return;
        useWorkspace.getState().upsert(session);
        if (!["CLOSED", "FAILED", "CLOSING"].includes(session.state))
          await attach(session.id);
      }
      if (!current() || connection !== socket || !socket.connected) return;
      const state = useWorkspace.getState();
      const workspaceId =
        state.workspaceId ??
        sessions.find((session) => session.workspaceId)?.workspaceId;
      const workspace = useCatalog
        .getState()
        .workspaces.find((workspace) => workspace.id === workspaceId);
      if (workspace)
        applyWorkspaceLayout(
          workspace,
          new Map(
            sessions
              .filter(
                (session) =>
                  session.workspaceId === workspace.id &&
                  session.workspaceEntryId &&
                  !["CLOSED", "FAILED", "CLOSING"].includes(session.state),
              )
              .map((session) => [session.workspaceEntryId!, session.id]),
          ),
        );
    } catch (error) {
      if (connection === socket && current())
        useWorkspace.getState().setError(String(error));
    }
  });
  socket.on("disconnect", () => {
    socket.sendBuffer = [];
    if (connection !== socket) return;
    useWorkspace.setState({
      online: false,
      multiExec: false,
      selectedIds: [],
      attached: [],
      hostRequests: [],
      authRequests: [],
    });
  });
  socket.on("auth:invalidated", (error: unknown) => {
    if (connection !== socket) return;
    const parsed = apiErrorSchema.safeParse(error);
    if (parsed.success && isAuthenticationError(parsed.data))
      invalidateAuthentication(parsed.data);
  });
  socket.on("connect_error", (error: Error & { data?: unknown }) => {
    if (connection !== socket) return;
    const parsed = apiErrorSchema.safeParse(error.data);
    if (parsed.success && isAuthenticationError(parsed.data)) {
      invalidateAuthentication(parsed.data);
      return;
    }
    useWorkspace
      .getState()
      .setError(
        "Secure browser connection unavailable; sign in again if your session expired",
      );
  });
  socket.on("session:state", (session: SessionDto) => {
    if (connection !== socket) return;
    const parsed = sessionDtoSchema.safeParse(session);
    if (!parsed.success) {
      useWorkspace.getState().setError("Invalid session response");
      return;
    }
    session = parsed.data;
    useWorkspace.getState().upsert(session);
    if (["FAILED", "CLOSED"].includes(session.state))
      useWorkspace.setState((state) => ({
        hostRequests: state.hostRequests.filter(
          (r) => r.sessionId !== session.id,
        ),
        authRequests: state.authRequests.filter(
          (r) => r.sessionId !== session.id,
        ),
      }));
  });
  socket.on("terminal:data", (frame: OutputFrame, acknowledge: () => void) => {
    const session = useWorkspace
      .getState()
      .sessions.find((s) => s.id === frame.sessionId);
    if (
      connection !== socket ||
      !session ||
      ["CLOSED", "FAILED", "CLOSING"].includes(session.state)
    ) {
      acknowledge();
      return;
    }
    const runtime = terminalFor(frame.sessionId);
    if (frame.sequence > runtime.sequence) {
      runtime.sequence = frame.sequence;
      runtime.write(new Uint8Array(frame.data), acknowledge);
    } else acknowledge();
  });
  socket.on("session:replay", (replay: Replay, acknowledge: () => void) => {
    const session = useWorkspace
      .getState()
      .sessions.find((s) => s.id === replay.sessionId);
    if (
      connection !== socket ||
      !session ||
      ["CLOSED", "FAILED", "CLOSING"].includes(session.state)
    ) {
      acknowledge();
      return;
    }
    const runtime = terminalFor(replay.sessionId);
    if (replay.reset) {
      runtime.terminal.reset();
      runtime.sequence = 0;
      if (replay.truncated)
        runtime.terminal.writeln(
          "\x1b[33m[Earlier output was truncated]\x1b[0m",
        );
    }
    const frames = replay.frames.filter(
      (frame) => frame.sequence > runtime.sequence,
    );
    if (!frames.length) {
      acknowledge();
      return;
    }
    frames.forEach((frame, index) => {
      runtime.sequence = frame.sequence;
      runtime.write(
        new Uint8Array(frame.data),
        index === frames.length - 1 ? acknowledge : undefined,
      );
    });
  });
  socket.on("hostkey:request", (request: HostKeyRequest) => {
    if (connection !== socket) return;
    const parsed = hostKeyRequestSchema.safeParse(request);
    if (!parsed.success) {
      useWorkspace.getState().setError("Invalid host verification request");
      return;
    }
    useWorkspace.setState((state) => ({
      multiExec: false,
      selectedIds: [],
      hostRequests: [
        ...state.hostRequests.filter((r) => r.sessionId !== request.sessionId),
        parsed.data,
      ],
    }));
  });
  socket.on("auth:request", (request: AuthRequest) => {
    if (connection !== socket) return;
    const parsed = authRequestSchema.safeParse(request);
    if (!parsed.success) {
      useWorkspace.getState().setError("Invalid authentication request");
      return;
    }
    useWorkspace.setState((state) => ({
      multiExec: false,
      selectedIds: [],
      authRequests: [
        ...state.authRequests.filter((r) => r.sessionId !== request.sessionId),
        parsed.data,
      ],
    }));
  });
  socket.on("session:replaced", ({ sessionId }: { sessionId: string }) => {
    if (connection !== socket) return;
    const current = useWorkspace
      .getState()
      .sessions.find((s) => s.id === sessionId);
    useWorkspace.getState().setAttached(sessionId, false);
    if (current)
      useWorkspace.getState().upsert({ ...current, state: "DETACHED" });
    useWorkspace
      .getState()
      .setError("Terminal control moved to another browser");
  });
}
export function disconnectTransport() {
  removeNetworkListeners?.();
  removeNetworkListeners = null;
  connection?.disconnect();
  connection = null;
  inputController.bind(null);
  useWorkspace.setState({ online: false });
}
export async function attach(sessionId: string) {
  const socket = connection;
  const current = currentOperation();
  const runtime = terminalFor(sessionId);
  await emit("session:attach", {
    sessionId,
    ...(runtime.sequence ? { afterSequence: runtime.sequence } : {}),
  });
  if (socket !== connection || !socket?.connected || !current()) return;
  useWorkspace.getState().setAttached(sessionId, true);
  const session = useWorkspace
    .getState()
    .sessions.find((session) => session.id === sessionId);
  if (
    session?.capabilities.resize &&
    runtime.element.clientWidth &&
    runtime.element.clientHeight
  ) {
    runtime.fit.fit();
    await emit("terminal:resize", {
      sessionId,
      columns: runtime.terminal.cols,
      rows: runtime.terminal.rows,
    });
  }
}
