import { z } from "zod";
import { readFileSync } from "node:fs";
const csv = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  CREDENTIAL_MASTER_KEY: z.string().optional(),
  CREDENTIAL_MASTER_KEY_FILE: z.string().optional(),
  ALLOWED_CIDRS: z.string().default(""),
  DENIED_CIDRS: z
    .string()
    .default("127.0.0.0/8,::1/128,169.254.0.0/16,fe80::/10,0.0.0.0/8,::/128"),
  ALLOWED_PORTS: z.string().default("22"),
  ALLOWED_DNS_SUFFIXES: z.string().default(""),
  SESSION_GRACE_SECONDS: z.coerce.number().int().min(1).max(86400).default(600),
  SSH_ATTEMPTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(120),
  MAX_SSH_SESSIONS: z.coerce.number().int().min(1).max(1024).default(32),
  WEB_SESSION_HOURS: z.coerce.number().min(0.01).max(168).default(12),
  PROMPT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(60),
  SSH_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(90),
  SERVE_WEB: z.enum(["true", "false"]).default("false"),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = schema.parse(env);
  const keyText = raw.CREDENTIAL_MASTER_KEY_FILE
    ? readFileSync(raw.CREDENTIAL_MASTER_KEY_FILE, "utf8").trim()
    : raw.CREDENTIAL_MASTER_KEY;
  const masterKey = Buffer.from(keyText ?? "", "base64");
  if (masterKey.length !== 32 || masterKey.toString("base64") !== keyText)
    throw new Error(
      "A canonical base64 32-byte credential master key is required",
    );
  const origin = new URL(raw.APP_ORIGIN);
  if (
    origin.origin !== raw.APP_ORIGIN ||
    (raw.NODE_ENV === "production" && origin.protocol !== "https:")
  )
    throw new Error(
      "APP_ORIGIN must be an exact origin; production requires HTTPS",
    );
  const allowedPorts = csv(raw.ALLOWED_PORTS).map(Number);
  if (allowedPorts.some((n) => !Number.isInteger(n) || n < 1 || n > 65535))
    throw new Error("Invalid allowed port");
  return {
    ...raw,
    masterKey,
    allowedCidrs: csv(raw.ALLOWED_CIDRS),
    deniedCidrs: csv(raw.DENIED_CIDRS),
    allowedPorts,
    dnsSuffixes: csv(raw.ALLOWED_DNS_SUFFIXES),
    graceMs: raw.SESSION_GRACE_SECONDS * 1000,
    promptMs: raw.PROMPT_TIMEOUT_SECONDS * 1000,
    sshTimeoutMs: raw.SSH_TIMEOUT_SECONDS * 1000,
    webSessionMs: raw.WEB_SESSION_HOURS * 3600000,
    secureCookie: origin.protocol === "https:",
  };
}
export type Config = ReturnType<typeof loadConfig>;
