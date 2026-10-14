import type { Socket } from "socket.io-client";
import { useWorkspace } from "./store";
export class InputController {
  private socket: Socket | null = null;
  private pendingBytes = 0;
  private pendingFrames = 0;
  private generation = 0;
  private readonly disconnected = () => {
    this.pendingBytes = 0;
    this.pendingFrames = 0;
    this.generation++;
    useWorkspace.getState().resetBroadcast();
    useWorkspace.setState({ attached: [] });
    if (this.socket) this.socket.sendBuffer = [];
  };
  bind(socket: Socket | null) {
    this.socket?.off("disconnect", this.disconnected);
    this.disconnected();
    this.socket = socket;
    socket?.on("disconnect", this.disconnected);
  }
  targets(sessionId: string): string[] {
    const state = useWorkspace.getState();
    if (
      (typeof navigator !== "undefined" && navigator.onLine === false) ||
      !this.socket?.connected ||
      !state.online ||
      state.hostRequests.length ||
      state.authRequests.length
    )
      return [];
    const ids =
      state.multiExec && !state.sensitive && !state.singleInput
        ? state.selectedIds
        : [sessionId];
    return ids.filter(
      (id) =>
        state.attached.includes(id) &&
        state.sessions.some(
          (s) => s.id === id && s.state === "OPEN" && s.capabilities.terminal,
        ),
    );
  }
  send(sessionId: string, data: string) {
    this.deliver(this.targets(sessionId), () => data);
  }
  paste(
    sessionId: string,
    data: string,
    encode: (id: string, text: string) => string = (_id, text) => text,
  ) {
    const bytes = new TextEncoder().encode(data).byteLength;
    const state = useWorkspace.getState();
    if (bytes > 65536) {
      state.setError("Paste exceeds the 64 KiB input limit");
      return;
    }
    const targets = this.targets(sessionId);
    if (!targets.length || !data) return;
    const generation = this.generation;
    if (
      (/[\r\n]/.test(data) || bytes > 4096 || targets.length > 1) &&
      !window.confirm(
        `Paste into ${targets.length} selected terminal${targets.length === 1 ? "" : "s"}?\nTargets: ${targets.map((id) => state.sessions.find((session) => session.id === id)?.name ?? id).join(", ")}\n\n${data.slice(0, 1024)}${data.length > 1024 ? "\n[Preview truncated]" : ""}\n\nText may execute commands immediately.`,
      )
    )
      return;
    if (generation !== this.generation) return;
    const current = this.targets(sessionId);
    if (
      current.length !== targets.length ||
      targets.some((id) => !current.includes(id))
    ) {
      state.setError(
        "Paste targets changed; paste was discarded. Review selection and paste again.",
      );
      return;
    }
    this.deliver(targets, (id) => encode(id, data));
  }
  private deliver(targets: string[], dataFor: (id: string) => string) {
    const socket = this.socket;
    if (!socket?.connected || !targets.length) return;
    const frames = targets.map((sessionId) => ({
      sessionId,
      data: dataFor(sessionId),
    }));
    const bytes = frames.reduce(
      (sum, frame) => sum + new TextEncoder().encode(frame.data).byteLength,
      0,
    );
    if (
      this.pendingBytes + bytes > 262144 ||
      this.pendingFrames + frames.length > 128 ||
      frames.some(
        (frame) => new TextEncoder().encode(frame.data).byteLength > 65536,
      )
    ) {
      useWorkspace
        .getState()
        .setError("Terminal input queue is full; input was discarded");
      return;
    }
    for (const frame of frames) {
      const frameBytes = new TextEncoder().encode(frame.data).byteLength;
      this.pendingBytes += frameBytes;
      this.pendingFrames++;
      const generation = this.generation;
      socket
        .timeout(5000)
        .emit(
          "terminal:input",
          frame,
          (
            error: Error | null,
            reply?: { ok: boolean; error?: { message: string } },
          ) => {
            if (generation !== this.generation) return;
            this.pendingBytes -= frameBytes;
            this.pendingFrames--;
            if (error || !reply?.ok)
              useWorkspace
                .getState()
                .setError(
                  reply?.error?.message ??
                    "Terminal input was not acknowledged",
                );
          },
        );
    }
  }
}
export const inputController = new InputController();
