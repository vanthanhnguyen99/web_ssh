import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { io, type Socket } from "socket.io-client";
import { describe, expect, it } from "vitest";
import { compose } from "../apps/server/src/composition.js";
import { loadConfig } from "../apps/server/src/infrastructure/config.js";
import { migrate } from "../apps/server/src/infrastructure/migrate.js";
import { createDatabase } from "../apps/server/src/infrastructure/database.js";
import { createAdministrator } from "../apps/server/src/infrastructure/bootstrap.js";
import type {
  OutputFrame,
  Replay,
  SessionDto,
  SocketReply,
} from "../packages/shared/src/index.js";

const fixtureUrl =
  "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test";
const origin = "http://localhost:5173";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() >= deadline)
      throw new Error("Performance review condition timed out");
    await pause(5);
  }
}

describe.skipIf(process.env.RUN_PERFORMANCE_INTEGRATION !== "1")(
  "independent review: real SSH capacity and recovery",
  () => {
    it("handles 32 connections, bounded high output, and original-session reattachment", async () => {
      await migrate(fixtureUrl);
      const db = createDatabase(fixtureUrl);
      const username = `load-review-${randomUUID()}`;
      const webPassword = "load-review-web-password";
      const owner = await createAdministrator(db.db, username, webPassword);
      let app: Awaited<ReturnType<typeof compose>> | undefined;
      let socket: Socket | undefined;
      const states = new Map<string, SessionDto>();
      const output = new Map<string, string>();
      const replays = new Map<string, Replay>();
      const ids: string[] = [];
      let cookie = "";
      let csrf = "";
      let base = "";
      let stage = "setup";
      const receive = (sessionId: string, data: Uint8Array) => {
        output.set(
          sessionId,
          ((output.get(sessionId) ?? "") + Buffer.from(data).toString()).slice(
            -65536,
          ),
        );
      };

      async function request(path: string, method = "GET", body?: unknown) {
        return fetch(base + path, {
          method,
          headers: {
            origin,
            cookie,
            "x-csrf-token": csrf,
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      }
      async function connectSocket() {
        const client = io(base, {
          transports: ["websocket"],
          auth: { csrfToken: csrf },
          extraHeaders: { origin, cookie },
          reconnection: false,
          forceNew: true,
        });
        client.on("session:state", (session: SessionDto) =>
          states.set(session.id, session),
        );
        client.on("terminal:data", (frame: OutputFrame, ack: () => void) => {
          receive(frame.sessionId, frame.data);
          ack();
        });
        client.on("session:replay", (replay: Replay, ack: () => void) => {
          replays.set(replay.sessionId, replay);
          if (replay.reset) output.set(replay.sessionId, "");
          for (const frame of replay.frames)
            receive(frame.sessionId, frame.data);
          ack();
        });
        await new Promise<void>((resolve, reject) => {
          client.once("connect", resolve);
          client.once("connect_error", reject);
        });
        return client;
      }
      async function send(event: string, data: unknown) {
        const result = await new Promise<SocketReply>((resolve, reject) => {
          socket!
            .timeout(5000)
            .emit(event, data, (error: Error | null, reply: SocketReply) => {
              if (error) reject(error);
              else resolve(reply);
            });
        });
        if (!result.ok)
          throw new Error(`${result.error.code}: ${result.error.message}`);
      }

      try {
        app = await compose(
          loadConfig({
            NODE_ENV: "test",
            APP_ORIGIN: origin,
            DATABASE_URL: fixtureUrl,
            CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
            ALLOWED_CIDRS: "127.0.0.1/32",
            DENIED_CIDRS: "169.254.0.0/16",
            ALLOWED_PORTS: "22222",
            SESSION_GRACE_SECONDS: "60",
            MAX_SSH_SESSIONS: "32",
          }),
        );
        base = await app.app.listen({ port: 0, host: "127.0.0.1" });
        const login = await request("/api/auth/login", "POST", {
          username,
          password: webPassword,
        });
        expect(login.status).toBe(200);
        cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        csrf = (await login.json()).csrfToken;
        socket = await connectSocket();
        const hostKey = execFileSync(
          "docker",
          [
            "compose",
            "-f",
            "tests/compose.yaml",
            "exec",
            "-T",
            "ssh",
            "cat",
            "/etc/ssh/ssh_host_ed25519_key.pub",
          ],
          { encoding: "utf8" },
        ).trim();
        expect(
          (
            await request("/api/host-keys", "POST", {
              host: "127.0.0.1",
              port: 22222,
              publicKey: hostKey,
            })
          ).status,
        ).toBe(201);

        const initialRss = process.memoryUsage().rss;
        stage = "32 live SSH connections";
        // Wait for each four-connection batch to authenticate before starting
        // the next batch; OpenSSH's unauthenticated MaxStartups remains intact.
        for (let offset = 0; offset < 32; offset += 4) {
          const batch = await Promise.all(
            Array.from({ length: 4 }, async () => {
              const response = await request("/api/sessions", "POST", {
                settings: {
                  host: "127.0.0.1",
                  port: 22222,
                  username: "lab",
                  hostKeyPolicy: "strict",
                },
                credential: { type: "password", password: "fixture-password" },
              });
              expect(response.status).toBe(201);
              const session: SessionDto = await response.json();
              ids.push(session.id);
              await send("session:attach", { sessionId: session.id });
              return session.id;
            }),
          );
          await eventually(() =>
            batch.every((id) => states.get(id)?.state === "OPEN"),
          );
        }
        expect(ids).toHaveLength(32);
        const overLimit = await request("/api/sessions", "POST", {
          settings: { host: "127.0.0.1", port: 22222, username: "lab" },
        });
        expect(overLimit.status).toBe(429);
        expect((await overLimit.json()).error.code).toBe(
          "SESSION_LIMIT_EXCEEDED",
        );

        const latencies: number[] = [];
        stage = "command latency";
        for (let sample = 0; sample < 60; sample++) {
          const id = ids[sample % ids.length]!;
          const marker = `__REVIEW_LATENCY_${sample}__`;
          const start = performance.now();
          await send("terminal:input", {
            sessionId: id,
            data: `printf '\\n%s\\n' '${marker}'\r`,
          });
          await eventually(
            () => output.get(id)?.includes(marker + "\r\n") ?? false,
          );
          if (sample >= 10) latencies.push(performance.now() - start);
        }
        latencies.sort((a, b) => a - b);
        const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;

        // Exercise real output substantially larger than retained history. A
        // slow consumer may be detached; the SSH shell must still survive.
        stage = "large output";
        await send("terminal:input", {
          sessionId: ids[0],
          data: "head -c 4194304 /dev/zero | tr '\\000' x; printf '\\n__REVIEW_OUTPUT_DONE__\\n'\r",
        });
        await pause(1000);
        socket.disconnect();
        await pause(100);
        replays.clear();
        const recoveryStart = performance.now();
        stage = "reattachment after large output";
        socket = await connectSocket();
        for (const id of ids) await send("session:attach", { sessionId: id });
        await eventually(
          () =>
            ids.every(
              (id) => replays.has(id) && states.get(id)?.state === "OPEN",
            ),
          5000,
        );
        const reattachMs = performance.now() - recoveryStart;
        const replay = replays.get(ids[0]!)!;
        const replayBytes = replay.frames.reduce(
          (sum, frame) => sum + frame.data.byteLength,
          0,
        );
        expect(replayBytes).toBeLessThanOrEqual(1048576);
        expect(replay.frames.length).toBeLessThanOrEqual(4096);
        expect(replay.truncated).toBe(true);
        expect(output.get(ids[0]!)).toContain("__REVIEW_OUTPUT_DONE__");
        const surviving: SessionDto[] = await (
          await request("/api/sessions")
        ).json();
        expect(
          surviving
            .filter((session) => session.state === "OPEN")
            .map((session) => session.id)
            .sort(),
        ).toEqual([...ids].sort());
        expect(reattachMs).toBeLessThan(5000);
        expect(p95).toBeLessThan(30);

        const metrics = await (await request("/api/metrics")).json();
        expect(JSON.stringify(metrics)).not.toContain(webPassword);
        expect(JSON.stringify(metrics)).not.toContain("fixture-password");
        const report = {
          connections: ids.length,
          endToEndCommandP95Ms: Number(p95.toFixed(2)),
          reattachMs: Number(reattachMs.toFixed(2)),
          retainedReplayBytes: replayBytes,
          retainedReplayFrames: replay.frames.length,
          testProcessRssIncreaseMiB: Number(
            ((process.memoryUsage().rss - initialRss) / 1048576).toFixed(2),
          ),
        };
        await mkdir("test-results", { recursive: true });
        await writeFile(
          "test-results/performance.json",
          JSON.stringify(report, null, 2) + "\n",
        );
        console.log("Real SSH baseline:", JSON.stringify(report));
        for (const id of ids)
          expect((await request(`/api/sessions/${id}`, "DELETE")).status).toBe(
            200,
          );
        expect(
          (await (await request("/api/sessions")).json()).filter(
            (session: SessionDto) => session.state === "OPEN",
          ),
        ).toEqual([]);
      } catch (error) {
        throw new Error(`Real SSH review failed during ${stage}`, {
          cause: error,
        });
      } finally {
        socket?.disconnect();
        await app?.app.close();
        await db.pool.query("DELETE FROM users WHERE id=$1", [owner]);
        await db.pool.end();
      }
    }, 90000);
  },
);
