import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  SessionManager,
  type SessionSink,
} from "../apps/server/src/application/session-manager.js";
import { OwnershipAuthorization } from "../apps/server/src/domain/authorization.js";
import type {
  Principal,
  ProtocolConnection,
  TerminalChannel,
} from "../apps/server/src/domain/ports.js";
import { sshCapabilities } from "../packages/shared/src/index.js";
const principal: Principal = {
  user: { id: randomUUID(), username: "a", role: "admin" },
  webSessionId: randomUUID(),
  expiresAt: Date.now() + 100000,
  csrfToken: "token",
};
function fixture(options: { graceMs?: number; replayBytes?: number } = {}) {
  const manager = new SessionManager(new OwnershipAuthorization(), {
    maxSessions: 2,
    graceMs: options.graceMs ?? 1000,
    promptMs: 500,
    replayBytes: options.replayBytes,
  });
  let output: (data: Uint8Array) => void = () => {};
  const terminal: TerminalChannel = {
    write: vi.fn(() => true),
    resize: vi.fn(),
    close: vi.fn(),
    onData: (callback) => {
      output = callback;
      return vi.fn();
    },
    onClose: () => vi.fn(),
  };
  const connection: ProtocolConnection = {
    capabilities: sshCapabilities,
    terminal,
    close: vi.fn(),
  };
  const sink: SessionSink = {
    state: vi.fn(),
    output: vi.fn(),
    prompt: vi.fn(),
    replaced: vi.fn(),
  };
  const session = manager.create(
    principal,
    {
      name: "test",
      protocol: "ssh",
      host: "10.0.0.1",
      port: 22,
      username: "lab",
      capabilities: sshCapabilities,
    },
    async () => connection,
  );
  return {
    manager,
    session,
    connection,
    sink,
    terminal,
    output: (data: Uint8Array) => output(data),
  };
}
afterEach(() => vi.useRealTimers());
describe("live session lifecycle", () => {
  it("checks ownership and controller on input, resize, and prompt answers", async () => {
    const f = fixture();
    await new Promise((r) => setTimeout(r, 5));
    f.manager.attach(principal, f.session.id, "socket-a", f.sink);
    const other = {
      ...principal,
      user: { ...principal.user, id: randomUUID() },
    };
    expect(() =>
      f.manager.input(other, f.session.id, "socket-a", "secret"),
    ).toThrow("not owned");
    expect(() =>
      f.manager.resize(principal, f.session.id, "socket-b", 80, 24),
    ).toThrow("does not control");
    expect(() =>
      f.manager.respond(
        principal,
        f.session.id,
        "socket-b",
        randomUUID(),
        "auth:request",
        {},
      ),
    ).toThrow("does not control");
    expect(f.terminal.write).not.toHaveBeenCalled();
    f.manager.shutdown();
  });
  it("bounds replay bytes, reports a gap, and replaces controllers", async () => {
    const f = fixture({ replayBytes: 8 });
    await new Promise((r) => setTimeout(r, 5));
    f.manager.attach(principal, f.session.id, "a", f.sink);
    f.output(Buffer.from("123456"));
    f.output(Buffer.from("abcdef"));
    const replay = f.manager.attach(principal, f.session.id, "b", f.sink, 0);
    expect(replay.reset).toBe(true);
    expect(replay.truncated).toBe(true);
    expect(
      replay.frames.reduce((n, frame) => n + frame.data.byteLength, 0),
    ).toBeLessThanOrEqual(8);
    expect(f.sink.replaced).toHaveBeenCalledWith(f.session.id);
    f.manager.shutdown();
  });
  it("caps tiny output frame count independently of byte count", async () => {
    const f = fixture();
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 6000; i++) f.output(Buffer.from("x"));
    const replay = f.manager.attach(principal, f.session.id, "a", f.sink);
    expect(replay.frames).toHaveLength(4096);
    expect(replay.truncated).toBe(true);
    f.manager.shutdown();
  });
  it("keeps detached connections alive only within the grace period", async () => {
    vi.useFakeTimers();
    const f = fixture({ graceMs: 100 });
    await vi.advanceTimersByTimeAsync(1);
    f.manager.attach(principal, f.session.id, "a", f.sink);
    f.manager.detachController("a");
    expect(f.manager.list(principal.user.id)[0]?.state).toBe("DETACHED");
    await vi.advanceTimersByTimeAsync(99);
    expect(f.connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.connection.close).toHaveBeenCalledOnce();
    expect(f.manager.list(principal.user.id)[0]?.state).toBe("CLOSED");
    f.manager.shutdown();
  });
  it("closes immediately on logout and does not retain output resources", async () => {
    const f = fixture();
    await new Promise((r) => setTimeout(r, 5));
    f.manager.attach(principal, f.session.id, "a", f.sink);
    f.output(Buffer.from("output"));
    f.manager.closeByWebSession(principal.webSessionId);
    expect(f.connection.close).toHaveBeenCalledOnce();
    expect(
      f.manager.attach(principal, f.session.id, "a", f.sink).frames,
    ).toEqual([]);
    f.manager.shutdown();
  });
});
