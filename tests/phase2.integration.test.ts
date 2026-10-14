import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { compose } from "../apps/server/src/composition.js";
import { loadConfig } from "../apps/server/src/infrastructure/config.js";
import { migrate } from "../apps/server/src/infrastructure/migrate.js";
import { createDatabase } from "../apps/server/src/infrastructure/database.js";
import { createAdministrator } from "../apps/server/src/infrastructure/bootstrap.js";
import {
  workspaceRestoreSchema,
  groupLaunchSchema,
  type HostKeyRequest,
  type OutputFrame,
  type Replay,
  type SessionDto,
  type SocketReply,
  type Workspace,
  type Profile,
  type ProfileInput,
  type Folder,
} from "../packages/shared/src/index.js";
const enabled = process.env.RUN_SSH_INTEGRATION === "1";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test";
const origin = "http://localhost:5173";
async function eventually<T>(
  read: () => T,
  valid: (value: T) => boolean,
  timeout = 15000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (valid(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Phase 2 integration condition timed out");
}
describe.skipIf(!enabled)("real eight-session workspace lifecycle", () => {
  let application: Awaited<ReturnType<typeof compose>>,
    base: string,
    cookie: string,
    csrf: string,
    socket: Socket;
  let profiles: Profile[], workspace: Workspace, root: Folder, child: Folder;
  const states = new Map<string, SessionDto>(),
    outputs = new Map<string, string>(),
    replays: Replay[] = [],
    sequences = new Map<string, number>();
  const username = "phase2-" + randomUUID();
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    auth = { cookie, csrf },
  ) {
    return fetch(base + path, {
      method,
      headers: {
        origin,
        cookie: auth.cookie,
        "x-csrf-token": auth.csrf,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function json<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await request(path, method, body);
    expect(response.ok).toBe(true);
    return response.json();
  }
  function send(event: string, payload: unknown): Promise<SocketReply> {
    return new Promise((resolve, reject) =>
      socket
        .timeout(5000)
        .emit(event, payload, (error: Error | null, reply: SocketReply) =>
          error ? reject(error) : resolve(reply),
        ),
    );
  }
  async function connect() {
    socket = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: csrf },
      extraHeaders: { origin, cookie },
      forceNew: true,
      reconnection: false,
    });
    socket.on("hostkey:request", (request: HostKeyRequest) => {
      void send("hostkey:decision", {
        sessionId: request.sessionId,
        requestId: request.requestId,
        accept: true,
        save: false,
      });
    });
    socket.on("session:state", (session: SessionDto) =>
      states.set(session.id, session),
    );
    socket.on("terminal:data", (frame: OutputFrame, ack: () => void) => {
      outputs.set(
        frame.sessionId,
        (outputs.get(frame.sessionId) ?? "") +
          Buffer.from(frame.data).toString(),
      );
      sequences.set(frame.sessionId, frame.sequence);
      ack();
    });
    socket.on("session:replay", (replay: Replay, ack: () => void) => {
      replays.push(replay);
      ack();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
  }
  async function attachAll(sessions: SessionDto[]) {
    for (const session of sessions)
      expect(
        await send("session:attach", { sessionId: session.id }),
      ).toMatchObject({ ok: true });
    await eventually(
      () => sessions.map((s) => states.get(s.id)?.state),
      (s) => s.every((state) => state === "OPEN"),
    );
  }
  beforeAll(async () => {
    await migrate(databaseUrl);
    const database = createDatabase(databaseUrl);
    await createAdministrator(database.db, username, "phase2-web-password");
    await database.pool.end();
    application = await compose(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        APP_ORIGIN: origin,
        CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
        ALLOWED_CIDRS: "127.0.0.1/32",
        DENIED_CIDRS: "169.254.0.0/16",
        ALLOWED_PORTS: "22222",
        SESSION_GRACE_SECONDS: "20",
        PROMPT_TIMEOUT_SECONDS: "15",
      }),
    );
    base = await application.app.listen({ host: "127.0.0.1", port: 0 });
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username, password: "phase2-web-password" }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    csrf = (await login.json()).csrfToken;
    await connect();
    const credential = await json<{ id: string }>("/api/credentials", "POST", {
      name: "fixture",
      material: { type: "password", password: "fixture-password" },
    });
    root = await json<Folder>("/api/folders", "POST", { name: "DUT group" });
    child = await json<Folder>("/api/folders", "POST", {
      name: "nested",
      parentId: root.id,
    });
    profiles = [];
    for (let i = 0; i < 8; i++)
      profiles.push(
        await json<Profile>("/api/profiles", "POST", {
          protocol: "ssh",
          name: `DUT${i + 1}`,
          settings: { host: "127.0.0.1", port: 22222, username: "lab" },
          credentialId: credential.id,
          folderId: i < 4 ? root.id : child.id,
        }),
      );
    const entries = profiles.map((profile, i) => ({
      id: randomUUID(),
      profileId: profile.id,
      pane: i < 4 ? i : null,
    }));
    workspace = await json<Workspace>("/api/workspaces", "POST", {
      name: "eight DUTs",
      layout: {
        version: 1,
        layout: "grid",
        activeEntryId: entries[0]!.id,
        entries,
      },
    });
  });
  afterAll(async () => {
    socket?.disconnect();
    await application?.app.close();
  });
  it("restores eight PTYs, reuses surviving IDs, replays detached output, and reports missing profiles individually", async () => {
    const first = workspaceRestoreSchema.parse(
      await json("/api/workspaces/" + workspace.id + "/restore", "POST"),
    );
    expect(first.entries).toHaveLength(8);
    expect(first.entries.every((entry) => entry.session)).toBe(true);
    const sessions = first.entries.map((entry) => entry.session!);
    await attachAll(sessions);
    expect(application.sessions.liveCount()).toBe(8);
    for (const session of sessions) {
      expect(
        await send("terminal:input", {
          sessionId: session.id,
          data: `printf '__DUT_${session.id}__\\n'\r`,
        }),
      ).toMatchObject({ ok: true });
    }
    await eventually(
      () =>
        sessions.every((s) => outputs.get(s.id)?.includes(`__DUT_${s.id}__`)),
      Boolean,
    );
    const originalIds = sessions.map((s) => s.id);
    await send("terminal:input", {
      sessionId: sessions[0]!.id,
      data: "seq 1 10000; printf '__HIGH_OUTPUT_END__\\n'\r",
    });
    await eventually(
      () => outputs.get(sessions[0]!.id),
      (text) => !!text?.includes("\r\n__HIGH_OUTPUT_END__\r\n"),
    );
    const duplicate = workspaceRestoreSchema.parse(
      await json("/api/workspaces/" + workspace.id + "/restore", "POST"),
    );
    expect(duplicate.entries.map((entry) => entry.session?.id)).toEqual(
      originalIds,
    );
    const target = sessions[0]!;
    const marker = "__DETACHED_OUTPUT__";
    await send("terminal:input", {
      sessionId: target.id,
      data: `sleep 1; printf '${marker}\\n'\r`,
    });
    socket.disconnect();
    const detached = await eventually(
      () => application.sessions.liveCount(),
      (count) => count === 8,
    );
    expect(detached).toBe(8);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const listed = await json<SessionDto[]>("/api/sessions");
    expect(
      listed
        .filter((s) => originalIds.includes(s.id))
        .every((s) => s.state === "DETACHED"),
    ).toBe(true);
    await connect();
    replays.length = 0;
    await attachAll(sessions);
    expect(replays.every((replay) => replay.frames.length <= 1)).toBe(true);
    expect(
      replays.every(
        (replay) =>
          replay.frames.reduce(
            (bytes, frame) => bytes + frame.data.byteLength,
            0,
          ) <= 1048576,
      ),
    ).toBe(true);
    expect(
      replays.find((replay) => replay.sessionId === target.id)?.frames[0]
        ?.sequence,
    ).toBeGreaterThanOrEqual(sequences.get(target.id)!);
    expect(
      replays
        .find((replay) => replay.sessionId === target.id)
        ?.frames.map((frame) => Buffer.from(frame.data).toString())
        .join(""),
    ).toContain(marker);
    const resumed = workspaceRestoreSchema.parse(
      await json("/api/workspaces/" + workspace.id + "/restore", "POST"),
    );
    expect(resumed.entries.map((entry) => entry.session?.id)).toEqual(
      originalIds,
    );
    await request("/api/sessions/" + sessions[7]!.id, "DELETE");
    await request("/api/profiles/" + profiles[7]!.id, "DELETE");
    const partial = workspaceRestoreSchema.parse(
      await json("/api/workspaces/" + workspace.id + "/restore", "POST"),
    );
    expect(
      partial.entries.slice(0, 7).map((entry) => entry.session?.id),
    ).toEqual(originalIds.slice(0, 7));
    expect(partial.entries[7]).toMatchObject({ error: { code: "NOT_FOUND" } });
    for (const session of sessions.slice(0, 7))
      await request("/api/sessions/" + session.id, "DELETE");
    expect(application.sessions.liveCount()).toBe(0);
  });
  it("promotes a live Quick Connect profile with strict trust across browser attachment and reconnect", async () => {
    // Fixture-only keyscan establishes an independently imported known host.
    const scan = await promisify(execFile)("ssh-keyscan", [
      "-p",
      "22222",
      "-t",
      "ed25519",
      "127.0.0.1",
    ]);
    const publicKey = scan.stdout.trim().split(/\s+/).slice(1, 3).join(" ");
    await json("/api/host-keys", "POST", {
      host: "127.0.0.1",
      port: 22222,
      publicKey,
    });
    const ephemeral = await json<SessionDto>("/api/sessions", "POST", {
      settings: {
        host: "127.0.0.1",
        port: 22222,
        username: "lab",
        hostKeyPolicy: "strict",
      },
      credential: { type: "password", password: "fixture-password" },
    });
    await attachAll([ephemeral]);
    socket.disconnect();
    await connect();
    await attachAll([ephemeral]);
    const draft = await json<ProfileInput>(
      "/api/sessions/" + ephemeral.id + "/profile-draft",
    );
    expect(draft.settings.hostKeyPolicy).toBe("strict");
    expect(draft.credentialId).toBeNull();
    expect(JSON.stringify(draft)).not.toContain("fixture-password");
    const changed = await json<Profile>("/api/profiles", "POST", {
      ...draft,
      name: "changed",
      settings: { ...draft.settings, username: "different" },
    });
    expect(
      (
        await request("/api/sessions/" + ephemeral.id + "/profile", "POST", {
          profileId: changed.id,
        })
      ).status,
    ).toBe(400);
    const saved = await json<Profile>("/api/profiles", "POST", {
      ...draft,
      name: "promoted live",
    });
    const promoted = await json<SessionDto>(
      "/api/sessions/" + ephemeral.id + "/profile",
      "POST",
      { profileId: saved.id },
    );
    expect(promoted).toMatchObject({ id: ephemeral.id, profileId: saved.id });
    const entry = { id: randomUUID(), profileId: saved.id, pane: 0 };
    const savedWorkspace = await json<Workspace>("/api/workspaces", "POST", {
      name: "promoted",
      layout: {
        version: 1,
        layout: "single",
        activeEntryId: entry.id,
        entries: [entry],
      },
    });
    await json("/api/sessions/" + ephemeral.id + "/workspace", "PUT", {
      workspaceId: savedWorkspace.id,
      workspaceEntryId: entry.id,
    });
    const restored = workspaceRestoreSchema.parse(
      await json("/api/workspaces/" + savedWorkspace.id + "/restore", "POST"),
    );
    expect(restored.entries[0]?.session?.id).toBe(ephemeral.id);
    const reconnected = await json<SessionDto>(
      "/api/sessions/" + ephemeral.id + "/reconnect",
      "POST",
    );
    expect(reconnected.profileId).toBe(saved.id);
    const auth = new Promise<void>((resolve, reject) =>
      socket.once("auth:request", (request) => {
        send("auth:response", {
          sessionId: request.sessionId,
          requestId: request.requestId,
          credential: { type: "password", password: "fixture-password" },
        }).then(() => resolve(), reject);
      }),
    );
    expect(
      await send("session:attach", { sessionId: reconnected.id }),
    ).toMatchObject({ ok: true });
    await auth;
    await eventually(
      () => states.get(reconnected.id)?.state,
      (state) => state === "OPEN",
    );
    expect(
      (
        await json<Profile>(
          "/api/sessions/" + reconnected.id + "/profile-draft",
        )
      ).settings.hostKeyPolicy,
    ).toBe("strict");
    await request("/api/sessions/" + reconnected.id, "DELETE");
  });
  it("launches nested groups and prevents cycle and unauthorized workspace mutations", async () => {
    const cycle = await request("/api/folders/" + root.id, "PUT", {
      name: root.name,
      parentId: child.id,
    });
    expect(cycle.status).toBe(400);
    const launch = groupLaunchSchema.parse(
      await json("/api/folders/" + root.id + "/launch", "POST"),
    );
    expect(launch.entries).toHaveLength(7);
    await attachAll(launch.entries.map((entry) => entry.session!));
    expect(application.sessions.liveCount()).toBe(7);
    const foreignName = "phase2-other-" + randomUUID();
    const db = createDatabase(databaseUrl);
    await createAdministrator(db.db, foreignName, "phase2-web-password");
    await db.pool.end();
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        username: foreignName,
        password: "phase2-web-password",
      }),
    });
    const foreign = {
      cookie: login.headers.get("set-cookie")!.split(";")[0]!,
      csrf: (await login.json()).csrfToken,
    };
    for (const path of [
      "/api/workspaces/" + workspace.id + "/restore",
      "/api/folders/" + root.id + "/launch",
    ])
      expect((await request(path, "POST", undefined, foreign)).status).toBe(
        404,
      );
    expect(
      (
        await request(
          "/api/sessions/" + launch.entries[0]!.session!.id + "/workspace",
          "PUT",
          {
            workspaceId: workspace.id,
            workspaceEntryId: workspace.layout.entries[0]!.id,
          },
          foreign,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/api/sessions/" + launch.entries[0]!.session!.id + "/profile",
          "POST",
          { profileId: profiles[0]!.id },
          foreign,
        )
      ).status,
    ).toBe(404);
    await request("/api/folders/" + root.id, "DELETE");
    expect(
      (await json<Folder[]>("/api/folders")).find((f) => f.id === child.id)
        ?.parentId,
    ).toBeNull();
    expect(
      (await json<Profile[]>("/api/profiles")).filter(
        (p) => p.folderId === root.id,
      ),
    ).toEqual([]);
    await request("/api/auth/logout", "POST");
    expect(application.sessions.liveCount()).toBe(0);
  });
});
