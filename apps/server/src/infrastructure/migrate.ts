import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
export async function migrate(url: string) {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(75311001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(
      new URL("../../migrations/", import.meta.url),
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const existing = await client.query(
        "SELECT name FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (!existing.rowCount) {
        await client.query(await readFile(directory + name, "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await migrate(process.env.DATABASE_URL);
  console.log("Database migrations applied");
}
