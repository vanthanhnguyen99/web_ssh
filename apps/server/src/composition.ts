import { hash, argon2id } from "argon2";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./infrastructure/database.js";
import { loadConfig } from "./infrastructure/config.js";
import {
  PostgresAuditRepository,
  PostgresAuthRepository,
  PostgresCatalogRepository,
  PostgresTrustRepository,
  LocalIdentityProvider,
} from "./infrastructure/repositories.js";
import {
  CredentialCipher,
  PostgresCredentialStore,
} from "./infrastructure/credentials.js";
import { NetworkTargetPolicy } from "./infrastructure/target-policy.js";
import { SshProtocolAdapter } from "./infrastructure/ssh.js";
import { OwnershipAuthorization } from "./domain/authorization.js";
import { AuthService } from "./application/auth.js";
import { HostTrustService } from "./application/host-trust.js";
import { SessionManager } from "./application/session-manager.js";
import { CatalogService } from "./application/catalog.js";
import { SshSessionService } from "./application/sessions.js";
import { WorkspaceService } from "./application/workspaces.js";
import { ProcessMonitor } from "./infrastructure/operations.js";
import { createApp } from "./transport/http.js";
export async function compose(
  config = loadConfig(),
  options: { logStream?: { write(message: string): void } } = {},
) {
  const { pool, db } = createDatabase(config.DATABASE_URL);
  const sessions = new SessionManager(new OwnershipAuthorization(), {
    maxSessions: config.MAX_SSH_SESSIONS,
    graceMs: config.graceMs,
    promptMs: config.promptMs,
  });
  const auth = new AuthService(
    new LocalIdentityProvider(
      db,
      await hash(randomBytes(32), { type: argon2id }),
    ),
    new PostgresAuthRepository(db),
    sessions,
    config.webSessionMs,
  );
  const catalog = new PostgresCatalogRepository(db);
  const credentials = new PostgresCredentialStore(
    db,
    new CredentialCipher(config.masterKey),
  );
  const audit = new PostgresAuditRepository(db);
  const trust = new HostTrustService(new PostgresTrustRepository(db), audit);
  const protocols = new Map([
    ["ssh", new SshProtocolAdapter(config.sshTimeoutMs)],
  ]);
  const service = new SshSessionService(
    sessions,
    protocols,
    new NetworkTargetPolicy(config),
    catalog,
    credentials,
    trust,
    config.SSH_ATTEMPTS_PER_MINUTE,
    audit,
  );
  const catalogService = new CatalogService(catalog, credentials);
  const monitor = new ProcessMonitor();
  const app = await createApp({
    ...options,
    auth,
    sessions: service,
    catalog: catalogService,
    workspaces: new WorkspaceService(catalogService, service),
    metrics: () => ({
      sshSessions: sessions.liveCount(),
      ...sessions.metrics(),
      ...service.metrics(),
      ...trust.metrics(),
      ...monitor.snapshot(),
    }),
    config: {
      origin: config.APP_ORIGIN,
      secureCookie: config.secureCookie,
      webSessionMs: config.webSessionMs,
      ...(config.SERVE_WEB === "true"
        ? {
            webDirectory: fileURLToPath(
              new URL("../../web/dist/", import.meta.url),
            ),
          }
        : {}),
    },
    readiness: async () => {
      await pool.query("SELECT 1");
    },
  });
  sessions.onLifecycle((ownerId, session) => {
    void audit
      .record(
        ownerId,
        `session.${session.state.toLowerCase()}`,
        session.id,
        session.error ? { error: session.error.code } : {},
      )
      .catch(() => app.log.error("Session audit failed"));
  });
  const sweep = setInterval(
    () => auth.sweep().catch(() => app.log.error("Web session sweep failed")),
    5000,
  );
  sweep.unref();
  app.addHook("onClose", async () => {
    clearInterval(sweep);
    monitor.close();
    await pool.end();
  });
  return { app, config, catalog, credentials, trust, sessions, auth };
}
