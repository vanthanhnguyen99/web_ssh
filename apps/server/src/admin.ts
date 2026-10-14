import { createInterface } from "node:readline/promises";
import { createDatabase } from "./infrastructure/database.js";
import { createAdministrator } from "./infrastructure/bootstrap.js";
async function secret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run interactively in a TTY; passwords cannot be passed in arguments",
    );
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b")
          value = value.slice(0, -1);
        else value += character;
      }
    };
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("data", onData);
  });
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const input = createInterface({ input: process.stdin, output: process.stdout });
const username = (await input.question("Administrator username: ")).trim();
input.close();
if (!/^[a-zA-Z0-9._-]{1,128}$/.test(username))
  throw new Error("Invalid username");
let password = await secret("Password (minimum 12 characters): ");
const confirmation = await secret("Confirm password: ");
if (password.length < 12 || password !== confirmation)
  throw new Error("Password is too short or confirmation differs");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await createAdministrator(db, username, password);
  password = "";
  console.log("Administrator created");
} finally {
  await pool.end();
}
