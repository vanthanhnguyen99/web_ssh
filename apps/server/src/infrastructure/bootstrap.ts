import { randomUUID } from "node:crypto";
import { hash, argon2id } from "argon2";
import type { Database } from "./database.js";
import { users } from "./schema.js";
export async function createAdministrator(
  db: Database,
  username: string,
  password: string,
) {
  if (password.length < 12)
    throw new Error("Password must have at least 12 characters");
  const id = randomUUID();
  await db.insert(users).values({
    id,
    username,
    passwordHash: await hash(password, { type: argon2id }),
    role: "admin",
  });
  return id;
}
