import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { SshProtocolAdapter } from "../apps/server/src/infrastructure/ssh.js";
import { modernAuthenticationKey } from "../apps/server/src/infrastructure/ssh-algorithms.js";
import { HostTrustService } from "../apps/server/src/application/host-trust.js";
import { sshSettingsSchema } from "../packages/shared/src/index.js";
import type {
  ProtocolConnection,
  TrustedKey,
} from "../apps/server/src/domain/ports.js";
const execute = promisify(execFile);
const ssh2 = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
)("ssh2") as {
  utils: {
    parseKey(value: string): ReturnType<typeof modernAuthenticationKey> | Error;
  };
};
const enabled = process.env.RUN_SSH_INTEGRATION === "1";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const remove of cleanup.splice(0).reverse()) await remove();
});
async function fixture(hostAlgorithm: string, userAlgorithm: string) {
  const directory = await mkdtemp(join(tmpdir(), "workspace-ssh-policy-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o755);
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const key = ssh2.utils.parseKey(pair.privateKey);
  if (key instanceof Error) throw key;
  const publicKey = "ssh-rsa " + key.getPublicSSH().toString("base64");
  await writeFile(join(directory, "hostkey"), pair.privateKey, { mode: 0o600 });
  await writeFile(join(directory, "authorized_keys"), publicKey + "\n", {
    mode: 0o644,
  });
  await writeFile(
    join(directory, "sshd_config"),
    [
      "Port 22",
      "ListenAddress 0.0.0.0",
      "HostKey /policy-fixture/hostkey",
      "PidFile /tmp/sshd-policy.pid",
      "AuthorizedKeysFile /policy-fixture/authorized_keys",
      "StrictModes no",
      "UsePAM no",
      "AllowUsers lab",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "PubkeyAuthentication yes",
      "LogLevel DEBUG3",
      `HostKeyAlgorithms ${hostAlgorithm}`,
      `PubkeyAcceptedAlgorithms ${userAlgorithm}`,
      "KexAlgorithms curve25519-sha256",
      "Ciphers aes256-ctr",
      "MACs hmac-sha2-512-etm@openssh.com",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  const image = (
    await execute("docker", [
      "compose",
      "-f",
      "tests/compose.yaml",
      "images",
      "-q",
      "ssh",
    ])
  ).stdout.trim();
  if (!image)
    throw new Error(
      "Start disposable SSH fixtures before policy integration tests",
    );
  const name = "workspace-ssh-policy-" + randomBytes(6).toString("hex");
  await execute("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::22",
    "--mount",
    `type=bind,src=${directory},dst=/policy-fixture,readonly`,
    image,
    "/usr/sbin/sshd",
    "-D",
    "-e",
    "-f",
    "/policy-fixture/sshd_config",
  ]);
  cleanup.push(async () => {
    await execute("docker", ["rm", "-f", name]);
  });
  const published = (
    await execute("docker", ["port", name, "22/tcp"])
  ).stdout.trim();
  const port = Number(published.split(":").at(-1));
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    ready = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      const finish = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.once("data", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(200, () => finish(false));
    });
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error("Policy SSH fixture did not start");
  const settings = sshSettingsSchema.parse({
    host: "127.0.0.1",
    port,
    username: "lab",
    hostKeyPolicy: "strict",
  });
  let saved: TrustedKey | null = null;
  const trust = new HostTrustService(
    {
      find: async () => saved,
      save: async (key) => {
        saved = key;
        return true;
      },
      verified: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
    { record: vi.fn() },
  );
  await trust.import("policy-test", { host: settings.host, port, publicKey });
  const verifyHostKey = vi.fn((bytes: Uint8Array) =>
    trust.verify("policy-test", randomUUID(), settings, bytes, async () => ({
      accept: false,
      save: false,
    })),
  );
  const authenticate = vi.fn(async () => ({
    type: "key" as const,
    privateKey: pair.privateKey,
  }));
  const context = {
    target: { host: settings.host, address: settings.host, port },
    settings,
    signal: new AbortController().signal,
    verifyHostKey,
    authenticate,
    authenticating: vi.fn(),
    requestPassphrase: vi.fn(),
  };
  return {
    context,
    verifyHostKey,
    authenticate,
    logs: async () => {
      const result = await execute("docker", ["logs", name]);
      return result.stdout + result.stderr;
    },
    own: (connection: ProtocolConnection) =>
      cleanup.push(async () => {
        connection.close();
        await new Promise((resolve) => setTimeout(resolve, 30));
      }),
  };
}
describe.skipIf(!enabled)("real OpenSSH modern algorithm policy", () => {
  it("negotiates RSA-SHA2 host and user signatures, SHA2 KEX/MAC and CTR with strict RSA trust", async () => {
    const f = await fixture(
      "rsa-sha2-512,rsa-sha2-256",
      "rsa-sha2-512,rsa-sha2-256",
    );
    const connection = await new SshProtocolAdapter(5000).connect(f.context);
    f.own(connection);
    expect(connection.terminal).toBeDefined();
    expect(f.verifyHostKey).toHaveBeenCalledOnce();
    expect(f.authenticate).toHaveBeenCalledOnce();
    const logs = await f.logs();
    expect(logs).toContain("host key algorithm: rsa-sha2-512");
    expect(logs).toContain("kex: algorithm: curve25519-sha256");
    expect(logs).toContain(
      "cipher: aes256-ctr MAC: hmac-sha2-512-etm@openssh.com",
    );
    expect(logs).toMatch(/signature using rsa-sha2-(256|512) verified/);
  });
  it("rejects a SHA1-only RSA host signature before host trust or authentication", async () => {
    const f = await fixture("ssh-rsa", "rsa-sha2-512,rsa-sha2-256");
    await expect(
      new SshProtocolAdapter(5000).connect(f.context),
    ).rejects.toMatchObject({ code: "SSH_HANDSHAKE_FAILED" });
    expect(f.verifyHostKey).not.toHaveBeenCalled();
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(await f.logs()).toContain("no matching host key type");
  });
  it("rejects SHA1-only user authentication with a modern host and never sends a SHA1 proof", async () => {
    const f = await fixture("rsa-sha2-512,rsa-sha2-256", "ssh-rsa");
    await expect(
      new SshProtocolAdapter(5000).connect(f.context),
    ).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(f.verifyHostKey).toHaveBeenCalledOnce();
    expect(f.authenticate).toHaveBeenCalledOnce();
    const logs = await f.logs();
    expect(logs).toMatch(
      /signature algorithm rsa-sha2-(256|512) not in PubkeyAcceptedAlgorithms/,
    );
    expect(logs).not.toMatch(/signature using ssh-rsa verified/);
    expect(logs).not.toContain("Accepted publickey");
  });
});
