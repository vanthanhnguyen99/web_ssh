import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export function createDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}
export type Database = ReturnType<typeof createDatabase>["db"];
