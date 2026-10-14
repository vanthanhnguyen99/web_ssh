import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { compose } from "../apps/server/src/composition.js";
import { loadConfig } from "../apps/server/src/infrastructure/config.js";
import { migrate } from "../apps/server/src/infrastructure/migrate.js";
import { createDatabase } from "../apps/server/src/infrastructure/database.js";
import { createAdministrator } from "../apps/server/src/infrastructure/bootstrap.js";
import type {
  HostKeyRequest,
  AuthRequest,
  OutputFrame,
  SessionDto,
  SocketReply,
} from "../packages/shared/src/index.js";
const enabled = process.env.RUN_SSH_INTEGRATION === "1";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test";
const origin = "http://localhost:5173";
async function eventually<T>(
  read: () => T,
  valid: (value: T) => boolean,
  timeout = 10000,
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = read();
    if (valid(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for integration condition");
}
describe.skipIf(!enabled)("real OpenSSH HTTP + websocket gateway", () => {
  let logs = "";
  let application: Awaited<ReturnType<typeof compose>>;
  let base: string;
  let cookie: string;
  let csrf: string;
  let socket: Socket;
  const username = "test-" + randomUUID();
  const webPassword = "secure-test-password";
  let output = "";
  const hostRequests: HostKeyRequest[] = [];
  const states = new Map<string, SessionDto>();
  beforeAll(async () => {
    await migrate(databaseUrl);
    const database = createDatabase(databaseUrl);
    await createAdministrator(database.db, username, webPassword);
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
        SESSION_GRACE_SECONDS: "2",
        PROMPT_TIMEOUT_SECONDS: "5",
      }),
      {
        logStream: {
          write(message: string) {
            logs += message;
          },
        },
      },
    );
    base = await application.app.listen({ port: 0, host: "127.0.0.1" });
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username, password: webPassword }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    csrf = (await login.json()).csrfToken;
    socket = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: csrf },
      extraHeaders: { origin, cookie },
      forceNew: true,
      reconnection: false,
    });
    socket.on("hostkey:request", (request) => hostRequests.push(request));
    socket.on("session:state", (session) => states.set(session.id, session));
    socket.on("terminal:data", (frame: OutputFrame, ack: () => void) => {
      output += Buffer.from(frame.data).toString();
      ack();
    });
    socket.on("session:replay", (_replay: unknown, ack: () => void) => ack());
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
  });
  afterAll(async () => {
    socket?.disconnect();
    await application?.app.close();
  });
  async function request(path: string, method = "GET", body?: unknown) {
    return fetch(base + path, {
      method,
      headers: {
        cookie,
        origin,
        "x-csrf-token": csrf,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function send(event: string, payload: unknown): Promise<SocketReply> {
    return new Promise((resolve, reject) =>
      socket
        .timeout(5000)
        .emit(event, payload, (error: Error | null, reply: SocketReply) =>
          error ? reject(error) : resolve(reply),
        ),
    );
  }
  it("blocks CSRF, arbitrary targets, and unauthorized WebSocket origins", async () => {
    const csrfFailure = await fetch(base + "/api/sessions", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(csrfFailure.status).toBe(403);
    const malformed = await fetch(base + "/api/profiles", {
      method: "POST",
      headers: {
        cookie,
        origin,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    const badTarget = await request("/api/sessions", "POST", {
      settings: { host: "8.8.8.8", port: 22222, username: "lab" },
    });
    expect(badTarget.status).toBe(403);
    const hostile = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: csrf },
      extraHeaders: { origin: "https://evil.example", cookie },
      reconnection: false,
    });
    await new Promise<void>((resolve) =>
      hostile.once("connect_error", () => resolve()),
    );
    expect(hostile.connected).toBe(false);
    hostile.disconnect();
  });
  it("verifies host trust before authentication and streams a real PTY", async () => {
    const response = await request("/api/sessions", "POST", {
      settings: { host: "127.0.0.1", port: 22222, username: "lab" },
      credential: { type: "password", password: "fixture-password" },
    });
    expect(response.status).toBe(201);
    const session = (await response.json()) as SessionDto;
    expect(
      await send("session:attach", { sessionId: session.id }),
    ).toMatchObject({ ok: true });
    const host = await eventually(
      () => hostRequests.find((h) => h.sessionId === session.id),
      Boolean,
    );
    expect(host!.fingerprint).toMatch(/^SHA256:/);
    expect(states.get(session.id)?.state).toBe("HOST_KEY_PENDING");
    expect(output).toBe("");
    expect(
      await send("terminal:input", {
        sessionId: session.id,
        data: "must-not-run",
      }),
    ).toMatchObject({ ok: false, error: { code: "SESSION_EXPIRED" } });
    expect(socket.connected).toBe(true); // A pending terminal is not an expired web login.
    expect(
      await send("hostkey:decision", {
        sessionId: session.id,
        requestId: host!.requestId,
        accept: true,
        save: true,
      }),
    ).toMatchObject({ ok: true });
    await eventually(
      () => states.get(session.id)?.state,
      (value) => value === "OPEN",
    );
    await send("terminal:resize", {
      sessionId: session.id,
      columns: 100,
      rows: 30,
    });
    await send("terminal:input", {
      sessionId: session.id,
      data: "printf '__GATEWAY_OK__\\n'; stty size\r",
    });
    await eventually(
      () => output,
      (value) => value.includes("__GATEWAY_OK__") && value.includes("30 100"),
    );
    expect(
      await send("hostkey:decision", {
        sessionId: session.id,
        requestId: host!.requestId,
        accept: true,
        save: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    // Burst keystrokes must preserve arrival order across asynchronous authentication.
    const command = "printf '__FIFO_0123456789__\\n'\r";
    await Promise.all(
      [...command].map((data) =>
        send("terminal:input", { sessionId: session.id, data }),
      ),
    );
    const fifoOutput = await eventually(
      () => output,
      (value) =>
        value.includes("__FIFO_0123456789__") &&
        value.includes("printf '__FIFO_0123456789__\\n'"),
    );
    expect(fifoOutput).toContain("__FIFO_0123456789__");
    await request("/api/sessions/" + session.id, "DELETE");
    expect(application.sessions.liveCount()).toBe(0);
  });
  it("returns structured authentication failures and captures redacted logs", async () => {
    const response = await request("/api/sessions", "POST", {
      settings: { host: "127.0.0.1", port: 22222, username: "lab" },
      credential: { type: "password", password: "wrong-secret-for-redaction" },
    });
    const session = (await response.json()) as SessionDto;
    await send("session:attach", { sessionId: session.id });
    const failed = await eventually(
      () => states.get(session.id),
      (value) => value?.state === "FAILED",
    );
    expect(failed!.error?.code).toBe("AUTH_FAILED");
    expect(
      JSON.stringify(await (await request("/api/sessions")).json()),
    ).not.toContain("wrong-secret-for-redaction");
    application.app.log.info(
      {
        password: "root-log-secret",
        privateKey: "root-private-key-secret",
        credential: { password: "nested-log-secret" },
      },
      "Redaction verification",
    );
    expect(logs).not.toContain("root-log-secret");
    expect(logs).not.toContain("root-private-key-secret");
    expect(logs).not.toContain("nested-log-secret");
    expect(logs).not.toContain("wrong-secret-for-redaction");
    expect(logs).not.toContain(webPassword);
    expect(logs).not.toContain(cookie);
    expect(logs).toContain("[REDACTED]");
  });
  it("authenticates plain and encrypted OpenSSH keys, keeping saved key passphrases session-only", async () => {
    const plain = await readFile("tests/.fixture-key/key", "utf8");
    const encrypted = await readFile(
      "tests/.fixture-key/encrypted-key",
      "utf8",
    );
    const savedResponse = await request("/api/credentials", "POST", {
      name: "encrypted fixture key",
      material: {
        type: "key",
        privateKey: encrypted,
        passphrase: "must-not-be-persisted",
      },
    });
    expect(savedResponse.status).toBe(201);
    const saved = await savedResponse.json();
    expect(Object.keys(saved).sort()).toEqual(["id", "name", "type"]);
    expect(
      await application.credentials.get(
        (await application.auth.authenticate(cookie.split("=")[1]!)).user.id,
        saved.id,
      ),
    ).toEqual({ type: "key", privateKey: encrypted });
    const profileResponse = await request("/api/profiles", "POST", {
      protocol: "ssh",
      name: "Key DUT",
      settings: { host: "127.0.0.1", port: 22222, username: "lab" },
      credentialId: saved.id,
    });
    expect(profileResponse.status).toBe(201);
    const profile = await profileResponse.json();
    const prompts: AuthRequest[] = [];
    socket.on("auth:request", (request) => prompts.push(request));
    for (const input of [
      {
        settings: { host: "127.0.0.1", port: 22222, username: "lab" },
        credential: { type: "key", privateKey: plain },
      },
      {
        settings: { host: "127.0.0.1", port: 22222, username: "lab" },
        credential: {
          type: "key",
          privateKey: encrypted,
          passphrase: "fixture-key-passphrase",
        },
      },
      { profileId: profile.id },
    ]) {
      const response = await request("/api/sessions", "POST", input);
      expect(response.status).toBe(201);
      const session = await response.json();
      await send("session:attach", { sessionId: session.id });
      if ("profileId" in input) {
        const prompt = await eventually(
          () => prompts.find((p) => p.sessionId === session.id),
          Boolean,
        );
        expect(prompt!.methods).toEqual(["passphrase"]);
        expect(JSON.stringify(prompt)).not.toContain("PRIVATE KEY");
        await send("auth:response", {
          sessionId: session.id,
          requestId: prompt!.requestId,
          credential: {
            type: "passphrase",
            passphrase: "fixture-key-passphrase",
          },
        });
      }
      await eventually(
        () => states.get(session.id)?.state,
        (v) => v === "OPEN",
      );
      await request("/api/sessions/" + session.id, "DELETE");
    }
    expect(
      JSON.stringify(await (await request("/api/credentials")).json()),
    ).not.toContain("PRIVATE KEY");
    expect(logs).not.toContain("fixture-key-passphrase");
    expect(logs).not.toContain("must-not-be-persisted");
    expect(logs).not.toContain(plain);
  });
  it("preserves reconnect settings and challenges again for session-only credentials", async () => {
    const response = await request("/api/sessions", "POST", {
      settings: {
        host: "127.0.0.1",
        port: 22222,
        username: "lab",
        terminal: { type: "vt100", scrollback: 1000 },
      },
      credential: { type: "password", password: "fixture-password" },
    });
    const first = await response.json();
    await send("session:attach", { sessionId: first.id });
    await eventually(
      () => states.get(first.id)?.state,
      (v) => v === "OPEN",
    );
    await request("/api/sessions/" + first.id, "DELETE");
    const prompts: AuthRequest[] = [];
    socket.on("auth:request", (request) => prompts.push(request));
    const reconnected = await request(
      "/api/sessions/" + first.id + "/reconnect",
      "POST",
    );
    expect(reconnected.status).toBe(201);
    const second = await reconnected.json();
    expect(second.terminal).toMatchObject({ type: "vt100", scrollback: 1000 });
    expect(second.id).not.toBe(first.id);
    await send("session:attach", { sessionId: second.id });
    const prompt = await eventually(
      () => prompts.find((p) => p.sessionId === second.id),
      Boolean,
    );
    await send("auth:response", {
      sessionId: second.id,
      requestId: prompt!.requestId,
      credential: { type: "password", password: "fixture-password" },
    });
    await eventually(
      () => states.get(second.id)?.state,
      (v) => v === "OPEN",
    );
    await request("/api/sessions/" + second.id, "DELETE");
  });
  it("imports trusted public keys and blocks a real changed-key handshake before authentication", async () => {
    const keys = await (await request("/api/host-keys")).json();
    for (const key of keys) await request("/api/host-keys/" + key.id, "DELETE");
    const wrong = await readFile("tests/.fixture-key/key.pub", "utf8");
    const imported = await request("/api/host-keys", "POST", {
      host: "127.0.0.1",
      port: 22222,
      publicKey: wrong,
    });
    expect(imported.status).toBe(201);
    const trusted = await imported.json();
    expect(trusted.algorithm).toBe("ssh-ed25519");
    expect(trusted.fingerprint).toMatch(/^SHA256:/);
    expect(
      (
        await request("/api/host-keys", "POST", {
          host: "127.0.0.1",
          port: 22222,
          publicKey: wrong,
        })
      ).status,
    ).toBe(409);
    const prompts: AuthRequest[] = [];
    socket.on("auth:request", (p) => prompts.push(p));
    const response = await request("/api/sessions", "POST", {
      settings: { host: "127.0.0.1", port: 22222, username: "lab" },
    });
    const session = await response.json();
    await send("session:attach", { sessionId: session.id });
    const failed = await eventually(
      () => states.get(session.id),
      (v) => v?.state === "FAILED",
    );
    expect(failed!.error?.code).toBe("HOST_KEY_MISMATCH");
    expect(failed!.error?.details?.expected).toBe(trusted.fingerprint);
    expect(prompts.find((p) => p.sessionId === session.id)).toBeUndefined();
    await request("/api/host-keys/" + trusted.id, "DELETE");
  });
  it("cancels a pending host-key handshake without invoking callbacks on a disposed SSH client", async () => {
    const keys = await (await request("/api/host-keys")).json();
    for (const key of keys) await request("/api/host-keys/" + key.id, "DELETE");
    const session = await (
      await request("/api/sessions", "POST", {
        settings: { host: "127.0.0.1", port: 22222, username: "lab" },
      })
    ).json();
    await send("session:attach", { sessionId: session.id });
    const prompt = await eventually(
      () => hostRequests.find((r) => r.sessionId === session.id),
      Boolean,
    );
    await request("/api/sessions/" + session.id, "DELETE");
    expect(
      await send("hostkey:decision", {
        sessionId: session.id,
        requestId: prompt!.requestId,
        accept: true,
        save: true,
      }),
    ).toMatchObject({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(application.sessions.liveCount()).toBe(0);
  });
  it("strict mode requires a matching imported host key", async () => {
    const settings = {
      host: "127.0.0.1",
      port: 22222,
      username: "lab",
      hostKeyPolicy: "strict",
    };
    const unknown = await (
      await request("/api/sessions", "POST", { settings })
    ).json();
    await send("session:attach", { sessionId: unknown.id });
    const failed = await eventually(
      () => states.get(unknown.id),
      (v) => v?.state === "FAILED",
    );
    expect(failed!.error?.code).toBe("HOST_KEY_UNKNOWN");
    expect(
      hostRequests.find((r) => r.sessionId === unknown.id),
    ).toBeUndefined();
    // Test fixture only: keyscan is not an application trust source.
    const scan = await promisify(execFile)("ssh-keyscan", [
      "-p",
      "22222",
      "-t",
      "ed25519",
      "127.0.0.1",
    ]);
    const publicKey = scan.stdout.trim().split(/\s+/).slice(1, 3).join(" ");
    const imported = await request("/api/host-keys", "POST", {
      host: settings.host,
      port: settings.port,
      publicKey,
    });
    expect(imported.status).toBe(201);
    const trusted = await imported.json();
    const session = await (
      await request("/api/sessions", "POST", {
        settings,
        credential: { type: "password", password: "fixture-password" },
      })
    ).json();
    await send("session:attach", { sessionId: session.id });
    await eventually(
      () => states.get(session.id)?.state,
      (v) => v === "OPEN",
    );
    expect(
      hostRequests.find((r) => r.sessionId === session.id),
    ).toBeUndefined();
    await request("/api/sessions/" + session.id, "DELETE");
    await request("/api/host-keys/" + trusted.id, "DELETE");
  });
  it("isolates profiles, credentials, trust and socket session operations between users", async () => {
    const db = createDatabase(databaseUrl);
    const otherUser = "other-" + randomUUID();
    await createAdministrator(db.db, otherUser, webPassword);
    await db.pool.end();
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username: otherUser, password: webPassword }),
    });
    const otherCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const otherCsrf = (await login.json()).csrfToken;
    const others = (path: string, method = "GET", body?: unknown) =>
      fetch(base + path, {
        method,
        headers: {
          origin,
          cookie: otherCookie,
          "x-csrf-token": otherCsrf,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const credential = await (
      await request("/api/credentials", "POST", {
        name: "owned",
        material: { type: "password", password: "private-owner-secret" },
      })
    ).json();
    const profile = await (
      await request("/api/profiles", "POST", {
        protocol: "ssh",
        name: "owned",
        settings: { host: "127.0.0.1", port: 22222, username: "lab" },
        credentialId: credential.id,
      })
    ).json();
    expect(await (await others("/api/profiles")).json()).toEqual([]);
    expect(await (await others("/api/credentials")).json()).toEqual([]);
    expect(await (await others("/api/host-keys")).json()).toEqual([]);
    expect(
      (
        await others("/api/profiles/" + profile.id, "PUT", {
          protocol: "ssh",
          name: "stolen",
          settings: profile.settings,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await others("/api/credentials/" + credential.id, "PUT", {
          name: "stolen",
          material: { type: "password", password: "attacker" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await others("/api/profiles", "POST", {
          protocol: "ssh",
          name: "stolenref",
          settings: profile.settings,
          credentialId: credential.id,
        })
      ).status,
    ).toBe(404);
    await others("/api/profiles/" + profile.id, "DELETE");
    await others("/api/credentials/" + credential.id, "DELETE");
    expect(
      (await (await request("/api/profiles")).json()).some(
        (p: { id: string }) => p.id === profile.id,
      ),
    ).toBe(true);
    const ownTrust = await (
      await request("/api/host-keys", "POST", {
        host: "owned.lab",
        port: 22,
        publicKey: await readFile("tests/.fixture-key/key.pub", "utf8"),
      })
    ).json();
    await others("/api/host-keys/" + ownTrust.id, "DELETE");
    expect(
      (await (await request("/api/host-keys")).json()).some(
        (t: { id: string }) => t.id === ownTrust.id,
      ),
    ).toBe(true);
    await request("/api/host-keys/" + ownTrust.id, "DELETE");
    const session = await (
      await request("/api/sessions", "POST", { settings: profile.settings })
    ).json();
    const other = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: otherCsrf },
      extraHeaders: { origin, cookie: otherCookie },
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      other.once("connect", resolve);
      other.once("connect_error", reject);
    });
    for (const event of [
      "session:attach",
      "session:close",
      "terminal:input",
      "terminal:resize",
      "auth:response",
      "hostkey:decision",
    ]) {
      const payload = {
        sessionId: session.id,
        ...(event === "terminal:input" ? { data: "steal" } : {}),
        ...(event === "terminal:resize" ? { columns: 80, rows: 24 } : {}),
        ...(event === "auth:response"
          ? {
              requestId: randomUUID(),
              credential: { type: "password", password: "attack" },
            }
          : {}),
        ...(event === "hostkey:decision"
          ? { requestId: randomUUID(), accept: true, save: true }
          : {}),
      };
      const reply = await new Promise<SocketReply>((resolve) =>
        other.emit(event, payload, resolve),
      );
      expect(reply).toMatchObject({
        ok: false,
        error: { code: "SESSION_NOT_OWNED" },
      });
    }
    expect(
      (await others("/api/sessions/" + session.id + "/reconnect", "POST"))
        .status,
    ).toBe(403);
    other.disconnect();
    await request("/api/sessions/" + session.id, "DELETE");
    const preferenceResponse = await request("/api/preferences", "PUT", {
      theme: "classic-dark",
      sidebarWidth: 333,
      sidebarVisible: false,
      appearance: {
        palette: "solarized-dark",
        fontSize: 15,
        cursorStyle: "bar",
      },
      terminal: { scrollback: 7000 },
    });
    expect(preferenceResponse.status).toBe(200);
    expect(await (await request("/api/preferences")).json()).toMatchObject({
      theme: "classic-dark",
      sidebarWidth: 333,
      appearance: { palette: "solarized-dark" },
      terminal: { scrollback: 7000 },
    });
    expect(await (await others("/api/preferences")).json()).toMatchObject({
      theme: "classic-light",
    });
    expect(logs).not.toContain("private-owner-secret");
  });
  it("signals expired web authentication separately from terminal lifecycle failures", async () => {
    const db = createDatabase(databaseUrl);
    const expiredUser = "expiry-" + randomUUID();
    await createAdministrator(db.db, expiredUser, webPassword);
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username: expiredUser, password: webPassword }),
    });
    const expiredCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const result = await login.json();
    const connection = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: result.csrfToken },
      extraHeaders: { origin, cookie: expiredCookie },
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      connection.once("connect", resolve);
      connection.once("connect_error", reject);
    });
    const invalidation = new Promise<{ code: string }>((resolve) =>
      connection.once("auth:invalidated", resolve),
    );
    await db.pool.query(
      "UPDATE web_sessions SET expires_at=$1 WHERE user_id=$2",
      [new Date(Date.now() - 1000), result.user.id],
    );
    connection.emit("session:attach", { sessionId: randomUUID() }, () => {});
    expect(await invalidation).toMatchObject({ code: "SESSION_EXPIRED" });
    await eventually(
      () => connection.connected,
      (value) => !value,
    );
    connection.disconnect();
    const unauthenticated = io(base, {
      transports: ["websocket"],
      auth: { csrfToken: result.csrfToken },
      extraHeaders: { origin, cookie: expiredCookie },
      forceNew: true,
      reconnection: false,
    });
    const error = await new Promise<Error & { data?: { code: string } }>(
      (resolve) => unauthenticated.once("connect_error", resolve),
    );
    expect(error.data).toMatchObject({ code: "UNAUTHORIZED" });
    unauthenticated.disconnect();
    await db.pool.query("DELETE FROM users WHERE id=$1", [result.user.id]);
    await db.pool.end();
  });
});
