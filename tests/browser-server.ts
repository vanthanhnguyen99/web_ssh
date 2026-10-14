import { randomBytes } from "node:crypto";
import { migrate } from "../apps/server/src/infrastructure/migrate.js";
import { createDatabase } from "../apps/server/src/infrastructure/database.js";
import { createAdministrator } from "../apps/server/src/infrastructure/bootstrap.js";
import { compose } from "../apps/server/src/composition.js";
import { loadConfig } from "../apps/server/src/infrastructure/config.js";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test";
await migrate(url);
const database = createDatabase(url);
const existing = await database.pool.query(
  "SELECT id FROM users WHERE username=$1",
  ["browser-admin"],
);
if (!existing.rowCount)
  await createAdministrator(
    database.db,
    "browser-admin",
    "browser-test-password",
  );
await database.pool.end();
const { app } = await compose(
  loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url,
    APP_ORIGIN: "http://localhost:5173",
    CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
    ALLOWED_CIDRS: "127.0.0.1/32",
    DENIED_CIDRS: "169.254.0.0/16",
    ALLOWED_PORTS: "22222",
  }),
);
await app.listen({ host: "127.0.0.1", port: 3000 });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => app.close().then(() => process.exit(0)));
