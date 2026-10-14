import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../apps/server/src/infrastructure/database.js";
import { migrate } from "../apps/server/src/infrastructure/migrate.js";
import { createAdministrator } from "../apps/server/src/infrastructure/bootstrap.js";
import {
  CredentialCipher,
  PostgresCredentialStore,
} from "../apps/server/src/infrastructure/credentials.js";

// Explicit opt-in: this test creates and removes databases in the disposable
// Compose fixture only, never in the application or a supplied production URL.
describe.skipIf(process.env.RUN_BACKUP_INTEGRATION !== "1")(
  "independent review: database and encrypted-credential recovery",
  () => {
    it("restores migrations and credentials using the matching external key", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const sourceName = `review_source_${suffix}`;
      const restoredName = `review_restored_${suffix}`;
      const base = "postgres://workspace:workspace_test@127.0.0.1:55433/";
      const admin = createDatabase(base + "workspace_test");
      const masterKey = randomBytes(32);
      const secret = "backup-review-credential-never-in-dump";
      let source: ReturnType<typeof createDatabase> | undefined;
      let restored: ReturnType<typeof createDatabase> | undefined;
      const fixtureCommand = (args: string[], input?: Buffer) =>
        execFileSync(
          "docker",
          ["compose", "-f", "tests/compose.yaml", "exec", "-T", "db", ...args],
          {
            input,
            maxBuffer: 4 * 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

      try {
        // Names consist only of a fixed prefix and hexadecimal UUID.
        await admin.pool.query(`CREATE DATABASE "${sourceName}"`);
        await admin.pool.query(`CREATE DATABASE "${restoredName}"`);
        await migrate(base + sourceName);
        source = createDatabase(base + sourceName);
        const owner = await createAdministrator(
          source.db,
          "recovery-review",
          "backup-review-web-password",
        );
        const store = new PostgresCredentialStore(
          source.db,
          new CredentialCipher(masterKey),
        );
        const credential = await store.put(owner, "recovery credential", {
          type: "password",
          password: secret,
        });

        const dump = fixtureCommand(["pg_dump", "-U", "workspace", sourceName]);
        expect(dump.toString()).not.toContain(secret);
        expect(dump.toString()).not.toContain(masterKey.toString("base64"));
        fixtureCommand(
          ["psql", "-v", "ON_ERROR_STOP=1", "-U", "workspace", restoredName],
          dump,
        );

        // Startup migration remains idempotent after restoring its journal.
        await migrate(base + restoredName);
        restored = createDatabase(base + restoredName);
        const recovered = new PostgresCredentialStore(
          restored.db,
          new CredentialCipher(masterKey),
        );
        expect(await recovered.get(owner, credential.id)).toEqual({
          type: "password",
          password: secret,
        });
        expect(await recovered.list(owner)).toEqual([credential]);
        await expect(
          new PostgresCredentialStore(
            restored.db,
            new CredentialCipher(randomBytes(32)),
          ).get(owner, credential.id),
        ).rejects.toThrow();
      } finally {
        await source?.pool.end();
        await restored?.pool.end();
        await admin.pool.query(
          `DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`,
        );
        await admin.pool.query(
          `DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`,
        );
        await admin.pool.end();
        masterKey.fill(0);
      }
    });
  },
);
