import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io-client";
import { ConnectionGate } from "../apps/server/src/application/connection-gate.js";
import { CatalogService } from "../apps/server/src/application/catalog.js";
import { WorkspaceService } from "../apps/server/src/application/workspaces.js";
import type { SshSessionService } from "../apps/server/src/application/sessions.js";
import type {
  CatalogRepository,
  CredentialStore,
  Principal,
} from "../apps/server/src/domain/ports.js";
import {
  sshCapabilities,
  workspaceLayoutSchema,
  profileInputSchema,
  type SessionDto,
  type Workspace,
} from "../packages/shared/src/index.js";
import { InputController } from "../apps/web/src/lib/input";
import { useWorkspace } from "../apps/web/src/lib/store";
const principal: Principal = {
  user: { id: randomUUID(), username: "test", role: "admin" },
  webSessionId: randomUUID(),
  expiresAt: Date.now() + 60000,
  csrfToken: "token",
};
function session(id = randomUUID()): SessionDto {
  return {
    id,
    name: id,
    protocol: "ssh",
    host: "lab",
    port: 22,
    username: "lab",
    state: "OPEN",
    capabilities: sshCapabilities,
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("bounded group handshakes", () => {
  it("starts at most four, preserves queue order, and releases slots on failure", async () => {
    const gate = new ConnectionGate();
    let active = 0,
      peak = 0;
    const started: number[] = [];
    const release: (() => void)[] = [];
    const results = Array.from({ length: 8 }, (_, i) =>
      gate.run(new AbortController().signal, async () => {
        active++;
        peak = Math.max(peak, active);
        started.push(i);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
        if (i === 2) throw new Error("handshake failed");
        return i;
      }),
    );
    const settled = Promise.allSettled(results);
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    release.shift()!();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    while (release.length) {
      release.shift()!();
      await flush();
    }
    const outcomes = await settled;
    expect(peak).toBe(4);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(7);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("cancels queued attempts without starting their protocol adapter", async () => {
    const gate = new ConnectionGate(1);
    let release!: () => void;
    const active = gate.run(
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await flush();
    const controller = new AbortController();
    const dial = vi.fn();
    const queued = gate.run(controller.signal, dial);
    const rejected = expect(queued).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    controller.abort();
    await rejected;
    release();
    await active;
    expect(dial).not.toHaveBeenCalled();
    await expect(
      gate.run(new AbortController().signal, async () => "next"),
    ).resolves.toBe("next");
  });
});
describe("versioned workspace validation", () => {
  const first = { id: randomUUID(), profileId: randomUUID(), pane: 0 };
  const valid = {
    version: 1,
    layout: "grid",
    entries: [first],
    activeEntryId: first.id,
  };
  it("allows hidden entries while rejecting duplicate IDs/panes, out-of-layout panes, missing active IDs, and secret fields", () => {
    expect(
      workspaceLayoutSchema.safeParse({
        ...valid,
        entries: [
          first,
          { id: randomUUID(), profileId: first.profileId, pane: null },
        ],
      }).success,
    ).toBe(true);
    for (const value of [
      { ...valid, entries: [first, { ...first, pane: null }] },
      { ...valid, entries: [first, { ...first, id: randomUUID() }] },
      { ...valid, layout: "single", entries: [{ ...first, pane: 1 }] },
      { ...valid, activeEntryId: randomUUID() },
      { ...valid, password: "secret" },
      { ...valid, entries: [{ ...first, sessionId: randomUUID() }] },
    ])
      expect(workspaceLayoutSchema.safeParse(value).success).toBe(false);
  });
});
describe("folder and workspace application boundaries", () => {
  const parent = {
    id: randomUUID(),
    name: "root",
    parentId: null,
    sortOrder: 0,
  };
  const child = {
    id: randomUUID(),
    name: "child",
    parentId: parent.id,
    sortOrder: 0,
  };
  it("rejects folder cycles, foreign parents, and foreign profile references", async () => {
    const putFolder = vi.fn();
    const repository = {
      listFolders: vi.fn(async () => [parent, child]),
      putFolder,
      listProfiles: vi.fn(async () => []),
    } as unknown as CatalogRepository;
    const catalog = new CatalogService(repository, {} as CredentialStore);
    await expect(
      catalog.putFolder(
        principal,
        { ...parent, parentId: child.id },
        parent.id,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      catalog.putFolder(principal, {
        name: "new",
        parentId: randomUUID(),
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      catalog.putWorkspace(principal, {
        name: "foreign",
        layout: {
          version: 1,
          layout: "single",
          activeEntryId: null,
          entries: [{ id: randomUUID(), profileId: randomUUID(), pane: 0 }],
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(putFolder).not.toHaveBeenCalled();
    expect(repository.listFolders).toHaveBeenCalledWith(principal.user.id);
  });
  it("launches descendants only, and preserves individual launch failures", async () => {
    const profile = (folderId: string | null) => ({
      ...profileInputSchema.parse({
        protocol: "ssh",
        name: "lab",
        settings: { host: "lab", username: "lab" },
        folderId,
      }),
      id: randomUUID(),
    });
    const profiles = [profile(parent.id), profile(child.id), profile(null)];
    const catalog = {
      folders: vi.fn(async () => [parent, child]),
      profiles: vi.fn(async () => profiles),
    } as unknown as CatalogService;
    const create = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockRejectedValueOnce(new Error("dial failed"));
    const service = new WorkspaceService(catalog, {
      create,
    } as unknown as SshSessionService);
    const result = await service.launchFolder(principal, parent.id);
    expect(result.entries).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((call) => call[1].profileId)).toEqual(
      profiles.slice(0, 2).map((p) => p.id),
    );
    expect(result.entries[1]).toMatchObject({
      profileId: profiles[1]!.id,
      error: { code: "INTERNAL_ERROR" },
    });
  });
  it("serializes overlapping restores, reuses surviving entries, and isolates failures", async () => {
    const workspace: Workspace = {
      id: randomUUID(),
      name: "saved",
      layout: {
        version: 1,
        layout: "grid",
        activeEntryId: null,
        entries: Array.from({ length: 3 }, (_, i) => ({
          id: randomUUID(),
          profileId: randomUUID(),
          pane: i,
        })),
      },
    };
    const existing = {
      ...session(),
      workspaceId: workspace.id,
      workspaceEntryId: workspace.layout.entries[0]!.id,
      profileId: workspace.layout.entries[0]!.profileId,
    };
    const live = [existing];
    const create = vi.fn(async (_actor, input) => {
      if (input.profileId === workspace.layout.entries[2]!.profileId)
        throw Object.assign(new Error("missing"), {
          code: "NOT_FOUND",
          status: 404,
        });
      await flush();
      const created = {
        ...session(),
        workspaceId: input.workspaceId,
        workspaceEntryId: input.workspaceEntryId,
        profileId: input.profileId,
      };
      live.push(created);
      return created;
    });
    const service = new WorkspaceService(
      { workspace: vi.fn(async () => workspace) } as unknown as CatalogService,
      {
        manager: { list: vi.fn(() => live) },
        create,
      } as unknown as SshSessionService,
    );
    const [first, second] = await Promise.all([
      service.restore(principal, workspace.id),
      service.restore(principal, workspace.id),
    ]);
    expect(first.entries[0]).toMatchObject({ session: { id: existing.id } });
    expect(first.entries[1]?.session?.id).toBe(second.entries[1]?.session?.id);
    expect(first.entries[2]).toHaveProperty("error");
    expect(create).toHaveBeenCalledTimes(3);
  });
});
describe("selective terminal input", () => {
  let input: InputController;
  let emit: ReturnType<typeof vi.fn>;
  let disconnect: () => void;
  let socket: Socket;
  beforeEach(() => {
    emit = vi.fn((_event, _frame, ack) => ack(null, { ok: true }));
    const fake = {
      connected: true,
      sendBuffer: [],
      off: vi.fn(),
      on: vi.fn((_event, callback) => {
        disconnect = callback;
      }),
      timeout: vi.fn(),
    };
    fake.timeout.mockReturnValue({ emit });
    socket = fake as unknown as Socket;
    input = new InputController();
    input.bind(socket);
    const sessions = [
      session(),
      session(),
      session(),
      { ...session(), state: "DETACHED" as const },
    ];
    useWorkspace.setState({
      sessions,
      activeId: sessions[0]!.id,
      online: true,
      attached: sessions.map((s) => s.id),
      multiExec: true,
      selectedIds: sessions.map((s) => s.id),
      sensitive: false,
      singleInput: false,
      hostRequests: [],
      authRequests: [],
      error: null,
      layout: "grid",
      panes: sessions.map((s) => s.id),
    });
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  });
  it("sends only selected OPEN attached terminal-capable sessions", () => {
    const state = useWorkspace.getState();
    useWorkspace.setState({
      selectedIds: [
        state.sessions[0]!.id,
        state.sessions[2]!.id,
        state.sessions[3]!.id,
      ],
      attached: [state.sessions[0]!.id, state.sessions[3]!.id],
    });
    input.send(state.activeId!, "command\r");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toEqual({
      sessionId: state.activeId,
      data: "command\r",
    });
  });
  it.each(["sensitive", "singleInput"] as const)(
    "%s routes only to focused terminal",
    (flag) => {
      useWorkspace.setState({ [flag]: true });
      input.send(useWorkspace.getState().activeId!, "secret");
      expect(emit).toHaveBeenCalledTimes(1);
    },
  );
  it("confirms multi-target paste, allows cancellation, and rejects changed selection", () => {
    const active = useWorkspace.getState().activeId!;
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    input.paste(active, "single line");
    expect(emit).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockImplementationOnce(() => {
      useWorkspace.setState({ selectedIds: [active] });
      return true;
    });
    input.paste(active, "single line");
    expect(emit).not.toHaveBeenCalled();
    expect(useWorkspace.getState().error).toContain("targets changed");
  });
  it("confirms multiline/large single-target paste and encodes each target separately", () => {
    const active = useWorkspace.getState().activeId!;
    useWorkspace.setState({ multiExec: false });
    input.paste(active, "a\nb");
    input.paste(active, "x".repeat(4097));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    useWorkspace.setState({
      multiExec: true,
      selectedIds: useWorkspace
        .getState()
        .sessions.slice(0, 2)
        .map((s) => s.id),
    });
    input.paste(active, "safe", (id, text) =>
      id === active ? `\x1b[200~${text}\x1b[201~` : text,
    );
    expect(emit.mock.calls.slice(-2).map((call) => call[1].data)).toEqual([
      "\x1b[200~safe\x1b[201~",
      "safe",
    ]);
  });
  it("drops all input during authentication, disconnect, and attachment loss", () => {
    const state = useWorkspace.getState();
    useWorkspace.setState({
      authRequests: [
        {
          sessionId: state.activeId!,
          requestId: randomUUID(),
          methods: ["password"],
        },
      ],
    });
    input.send(state.activeId!, "secret");
    expect(emit).not.toHaveBeenCalled();
    useWorkspace.setState({ authRequests: [] });
    socket.connected = false;
    socket.sendBuffer.push({} as never);
    disconnect();
    input.send(state.activeId!, "offline");
    expect(emit).not.toHaveBeenCalled();
    expect(socket.sendBuffer).toEqual([]);
    expect(useWorkspace.getState()).toMatchObject({
      multiExec: false,
      selectedIds: [],
      attached: [],
    });
    socket.connected = true;
    input.send(state.activeId!, "unattached");
    expect(emit).not.toHaveBeenCalled();
  });
  it("rejects input when the browser reports offline before WebSocket heartbeat catches up", () => {
    vi.stubGlobal("navigator", { onLine: false });
    input.send(useWorkspace.getState().activeId!, "must-not-queue");
    expect(socket.connected).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });
  it("discards a confirmed paste if transport changes while confirmation is open", () => {
    vi.mocked(window.confirm).mockImplementationOnce(() => {
      disconnect();
      return true;
    });
    input.paste(useWorkspace.getState().activeId!, "multiline\n");
    expect(emit).not.toHaveBeenCalled();
  });
  it("rejects oversized paste and bounds unacknowledged input", () => {
    const active = useWorkspace.getState().activeId!;
    input.paste(active, "é".repeat(32769));
    expect(emit).not.toHaveBeenCalled();
    useWorkspace.setState({ multiExec: false });
    emit.mockImplementation(() => {});
    for (let i = 0; i < 129; i++) input.send(active, "x");
    expect(emit).toHaveBeenCalledTimes(128);
    expect(useWorkspace.getState().error).toContain("queue is full");
  });
  it("moves/reorders/removes panes without losing runtime session identity", () => {
    const state = useWorkspace.getState();
    const ids = state.sessions.map((s) => s.id);
    state.moveToPane(ids[0]!, 2);
    expect(useWorkspace.getState().panes).toEqual([
      ids[2],
      ids[1],
      ids[0],
      ids[3],
    ]);
    state.reorder(ids[3]!, ids[0]!);
    expect(useWorkspace.getState().sessions.map((s) => s.id)).toEqual([
      ids[3],
      ids[0],
      ids[1],
      ids[2],
    ]);
    state.upsert({ ...state.sessions[0]!, state: "FAILED" });
    expect(useWorkspace.getState().selectedIds).not.toContain(ids[0]);
    state.removeSession(ids[0]!);
    expect(useWorkspace.getState().attached).not.toContain(ids[0]);
    expect(useWorkspace.getState().panes).not.toContain(ids[0]);
  });
});
