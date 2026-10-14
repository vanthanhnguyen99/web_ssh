import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { io } from "socket.io-client";

// Local, disposable production smoke. Only this unique Compose project is
// removed. Generated keys/configuration stay in a private temporary directory.
const directory = await mkdtemp(join(tmpdir(), "web-ssh-deployment-review-"));
const project = `web-ssh-review-${randomBytes(4).toString("hex")}`;
const key = randomBytes(32).toString("base64");
const password = randomBytes(24).toString("hex");
const databasePassword = randomBytes(24).toString("hex");
const username = "deployment-review";
const origin = "https://localhost:18443";
const masterKeyFile = join(directory, "master-key");
const configurationFile = join(directory, "compose.json");
const environment = {
  ...process.env,
  APP_ORIGIN: origin,
  WORKSPACE_HOST: "localhost",
  HTTPS_PORT: "18443",
  POSTGRES_PASSWORD: databasePassword,
  CREDENTIAL_MASTER_KEY_PATH: masterKeyFile,
  ALLOWED_DNS_SUFFIXES: "",
};
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    env: environment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
const compose = (args, options) =>
  docker(["compose", "-p", project, "-f", configurationFile, ...args], options);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(read, check = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (check(value)) return value;
    } catch {
      /* Retry startup only. */
    }
    await pause(100);
  }
  throw new Error("Deployment smoke condition timed out");
}
let cookie = "";
let csrf = "";
let certificate;
let socket;
let started = false;
const states = new Map();
let output = "";

function request(path, method = "GET", body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      origin + path,
      {
        method,
        ca: certificate,
        rejectUnauthorized: true,
        headers: {
          origin,
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(data),
              }
            : {}),
          ...extraHeaders,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            /* Static assets are text. */
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json,
          });
        });
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(new Error("HTTPS request timed out")),
    );
    req.on("error", reject);
    req.end(data);
  });
}
async function connect() {
  const connection = io(origin, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: { csrfToken: csrf },
    extraHeaders: { origin, cookie },
    ca: certificate,
    rejectUnauthorized: true,
  });
  connection.on("session:state", (session) => states.set(session.id, session));
  connection.on("terminal:data", (frame, ack) => {
    output = (output + Buffer.from(frame.data).toString()).slice(-65536);
    ack();
  });
  connection.on("session:replay", (_replay, ack) => ack());
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("connect_error", reject);
  });
  return connection;
}
async function send(event, data) {
  const result = await new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, data, (error, reply) =>
        error ? reject(error) : resolve(reply),
      ),
  );
  assert.equal(result.ok, true);
}

try {
  await writeFile(masterKeyFile, key + "\n", { mode: 0o444 });
  const networkIds = docker(["network", "ls", "-q"])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const networks = JSON.parse(docker(["network", "inspect", ...networkIds]));
  const subnets = networks
    .flatMap((network) => network.IPAM.Config ?? [])
    .map((entry) => entry.Subnet)
    .filter(Boolean);
  const ipv4 = (value) =>
    value
      .split(".")
      .reduce((total, part) => (total * 256 + Number(part)) >>> 0, 0);
  const overlaps = (left, right) => {
    if (right.includes(":")) return false;
    const [a, x] = left.split("/");
    const [b, y] = right.split("/");
    const bits = Math.min(Number(x), Number(y));
    return !bits || ipv4(a) >>> (32 - bits) === ipv4(b) >>> (32 - bits);
  };
  const available = Array.from(
    { length: 15 },
    (_, i) => `172.29.${240 + i}.0/24`,
  ).filter((subnet) => !subnets.some((existing) => overlaps(subnet, existing)));
  assert.ok(available.length >= 2, "Two free review subnets are required");
  const infrastructure = available.includes("172.29.241.0/24")
    ? "172.29.241.0/24"
    : available[0];
  const lab = available.find(
    (subnet) => subnet !== infrastructure && subnet !== "172.29.241.0/24",
  );
  assert.ok(lab, "A free non-infrastructure lab subnet is required");
  const labIp = lab.replace(".0/24", ".10");
  environment.ALLOWED_CIDRS = lab;
  environment.ALLOWED_PORTS = "22";
  const configuration = JSON.parse(
    docker(["compose", "-f", "compose.yaml", "config", "--format", "json"]),
  );
  // `compose config` resolves default resource names for the source project.
  // Remove them so this isolated project can never reuse production volumes.
  delete configuration.name;
  for (const resource of Object.values(configuration.volumes ?? {}))
    delete resource.name;
  for (const resource of Object.values(configuration.secrets ?? {}))
    delete resource.name;
  configuration.services.caddy.ports = [
    { target: 443, published: "18443", host_ip: "127.0.0.1", protocol: "tcp" },
  ];
  delete configuration.services.app.build;
  configuration.services.app.image = "web-ssh-workspace:verification";
  configuration.services.app.networks = { default: null, review_lab: null };
  configuration.services.app.environment.DENIED_CIDRS += `,${infrastructure}`;
  configuration.services.app.environment.ALLOWED_CIDRS = lab;
  configuration.services.app.environment.ALLOWED_PORTS = "22";
  configuration.services["review-ssh"] = {
    image: "web-ssh-workspace-fixtures-ssh",
    networks: { review_lab: { ipv4_address: labIp } },
  };
  configuration.networks.default = {
    ipam: { config: [{ subnet: infrastructure }] },
  };
  configuration.networks.review_lab = { ipam: { config: [{ subnet: lab }] } };
  await writeFile(configurationFile, JSON.stringify(configuration, null, 2), {
    mode: 0o600,
  });
  started = true;
  compose(["up", "-d", "--wait", "--wait-timeout", "120"]);
  await eventually(
    () =>
      compose([
        "exec",
        "-T",
        "caddy",
        "test",
        "-f",
        "/data/caddy/pki/authorities/local/root.crt",
      ]),
    () => true,
  );
  compose([
    "cp",
    "caddy:/data/caddy/pki/authorities/local/root.crt",
    join(directory, "root.crt"),
  ]);
  certificate = await readFile(join(directory, "root.crt"));
  await eventually(
    () => request("/health/ready"),
    (response) => response.status === 200,
  );
  assert.notEqual(compose(["exec", "-T", "app", "id", "-u"]).trim(), "0");
  const appId = compose(["ps", "-q", "app"]).trim();
  assert.equal(
    docker([
      "inspect",
      "-f",
      "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Privileged}}",
      appId,
    ]).trim(),
    "true false",
  );
  const bootstrap = `import {createDatabase} from './apps/server/dist/infrastructure/database.js';
import {createAdministrator} from './apps/server/dist/infrastructure/bootstrap.js';
const {db,pool}=createDatabase(process.env.DATABASE_URL);
try{await createAdministrator(db,${JSON.stringify(username)},${JSON.stringify(password)});}finally{await pool.end();}`;
  compose(["exec", "-T", "app", "node", "--input-type=module", "-"], {
    input: bootstrap,
  });
  const shell = await request("/");
  assert.equal(shell.status, 200);
  assert.match(shell.text, /\/assets\//);
  assert.ok(shell.headers["content-security-policy"]);
  assert.ok(shell.headers["strict-transport-security"]);
  const login = await request("/api/auth/login", "POST", {
    username,
    password,
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers["set-cookie"][0];
  for (const attribute of ["Secure", "HttpOnly", "SameSite=Strict"])
    assert.ok(sessionCookie.includes(attribute));
  cookie = sessionCookie.split(";")[0];
  csrf = login.json.csrfToken;
  const denied = await request("/api/sessions", "POST", {
    settings: { host: "db", port: 22, username: "lab" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "TARGET_NOT_ALLOWED");
  assert.equal(
    (
      await request(
        "/api/sessions",
        "POST",
        {},
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const hostKey = compose([
    "exec",
    "-T",
    "review-ssh",
    "cat",
    "/etc/ssh/ssh_host_ed25519_key.pub",
  ]).trim();
  assert.equal(
    (
      await request("/api/host-keys", "POST", {
        host: "review-ssh",
        port: 22,
        publicKey: hostKey,
      })
    ).status,
    201,
  );
  const credential = await request("/api/credentials", "POST", {
    name: "smoke key",
    material: { type: "password", password: "fixture-password" },
  });
  assert.equal(credential.status, 201);
  const profile = await request("/api/profiles", "POST", {
    protocol: "ssh",
    name: "HTTPS review target",
    credentialId: credential.json.id,
    settings: {
      host: "review-ssh",
      port: 22,
      username: "lab",
      hostKeyPolicy: "strict",
    },
  });
  assert.equal(profile.status, 201);
  socket = await connect();
  const session = await request("/api/sessions", "POST", {
    profileId: profile.json.id,
  });
  assert.equal(session.status, 201);
  await send("session:attach", { sessionId: session.json.id });
  await eventually(
    () => states.get(session.json.id)?.state,
    (state) => state === "OPEN",
  );
  await send("terminal:input", {
    sessionId: session.json.id,
    data: "printf '__HTTPS_SSH_OK__\\n'\r",
  });
  await eventually(() => output.includes("__HTTPS_SSH_OK__\r\n"));
  const entryId = randomUUID();
  const workspace = await request("/api/workspaces", "POST", {
    name: "HTTPS review workspace",
    layout: {
      version: 1,
      layout: "single",
      entries: [{ id: entryId, profileId: profile.json.id, pane: 0 }],
      activeEntryId: entryId,
    },
  });
  assert.equal(workspace.status, 201);
  socket.disconnect();
  compose(["restart", "app"]);
  await eventually(
    () => request("/health/ready"),
    (response) => response.status === 200,
  );
  assert.equal((await request("/api/sessions")).json.length, 0);
  assert.ok(
    (await request("/api/profiles")).json.some(
      (item) => item.id === profile.json.id,
    ),
  );
  socket = await connect();
  const restored = await request(
    `/api/workspaces/${workspace.json.id}/restore`,
    "POST",
  );
  assert.equal(restored.status, 200);
  const restoredSession = restored.json.entries[0].session;
  await send("session:attach", { sessionId: restoredSession.id });
  await eventually(
    () => states.get(restoredSession.id)?.state,
    (state) => state === "OPEN",
  );
  // Successful stored-password authentication after restart proves ciphertext,
  // deployment master key, profile/workspace and host trust remained compatible.
  assert.equal((await request("/api/auth/logout", "POST")).status, 200);
  const logs = compose(["logs", "--no-color", "app"]);
  for (const secret of [
    password,
    databasePassword,
    key,
    "fixture-password",
    cookie,
  ])
    assert.ok(!logs.includes(secret), "Secret appeared in deployment logs");
  console.log(
    "HTTPS Docker smoke passed: trusted TLS, secure cookies, WSS/SSH, policy, non-root/read-only, restart persistence and log redaction.",
  );
} finally {
  socket?.disconnect();
  if (started) compose(["down", "--volumes", "--remove-orphans"]);
  await rm(directory, { recursive: true, force: true });
}
