import { z } from "zod";

export const idSchema = z.string().uuid();
export const sessionStateSchema = z.enum([
  "CREATED",
  "CONNECTING",
  "HOST_KEY_PENDING",
  "AUTHENTICATING",
  "OPEN",
  "DETACHED",
  "RECONNECTING",
  "CLOSING",
  "CLOSED",
  "FAILED",
]);
export type SessionState = z.infer<typeof sessionStateSchema>;
export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "DNS_RESOLUTION_FAILED",
  "TARGET_NOT_ALLOWED",
  "TCP_CONNECTION_REFUSED",
  "TCP_TIMEOUT",
  "SSH_HANDSHAKE_FAILED",
  "HOST_KEY_UNKNOWN",
  "HOST_KEY_MISMATCH",
  "AUTH_FAILED",
  "AUTH_METHOD_UNSUPPORTED",
  "PTY_ALLOCATION_FAILED",
  "CHANNEL_OPEN_FAILED",
  "SESSION_EXPIRED",
  "SESSION_NOT_OWNED",
  "SESSION_LIMIT_EXCEEDED",
  "SLOW_CONSUMER",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const apiErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string()).optional(),
  })
  .strict();
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, string>;
}
export const capabilitiesSchema = z
  .object({
    terminal: z.boolean(),
    resize: z.boolean(),
    files: z.boolean(),
    tunnels: z.boolean(),
    desktop: z.boolean(),
  })
  .strict();
export type ProtocolCapabilities = z.infer<typeof capabilitiesSchema>;
export const sshCapabilities: ProtocolCapabilities = {
  terminal: true,
  resize: true,
  files: false,
  tunnels: false,
  desktop: false,
};
export const terminalOptionsSchema = z
  .object({
    type: z
      .enum(["xterm-256color", "xterm", "vt100"])
      .default("xterm-256color"),
    columns: z.number().int().min(20).max(500).default(120),
    rows: z.number().int().min(5).max(300).default(40),
    keepaliveSeconds: z.number().int().min(5).max(300).default(30),
    scrollback: z.number().int().min(100).max(50000).default(5000),
  })
  .strict();
export const sshSettingsSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    port: z.number().int().min(1).max(65535).default(22),
    username: z
      .string()
      .min(1)
      .max(128)
      // eslint-disable-next-line no-control-regex -- Reject control characters in SSH usernames.
      .regex(/^[^\s\x00-\x1f]+$/),
    hostKeyPolicy: z.enum(["tofu", "strict"]).default("tofu"),
    terminal: terminalOptionsSchema.default({}),
  })
  .strict();
export type SshSettings = z.infer<typeof sshSettingsSchema>;
export const profileInputSchema = z.discriminatedUnion("protocol", [
  z
    .object({
      protocol: z.literal("ssh"),
      name: z.string().trim().min(1).max(128),
      settings: sshSettingsSchema,
      folderId: idSchema.nullable().default(null),
      credentialId: idSchema.nullable().default(null),
    })
    .strict(),
]);
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const profileSchema = z
  .object({
    id: idSchema,
    protocol: z.literal("ssh"),
    name: z.string(),
    settings: sshSettingsSchema,
    folderId: idSchema.nullable(),
    credentialId: idSchema.nullable(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
export const authMaterialSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("password"), password: z.string().max(16384) })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      privateKey: z.string().min(1).max(65536),
      passphrase: z.string().max(16384).optional(),
    })
    .strict(),
]);
export type AuthMaterial = z.infer<typeof authMaterialSchema>;
export const createSessionSchema = z
  .object({
    protocol: z.literal("ssh").default("ssh"),
    settings: sshSettingsSchema.optional(),
    profileId: idSchema.optional(),
    credential: authMaterialSchema.optional(),
    workspaceEntryId: idSchema.optional(),
    workspaceId: idSchema.optional(),
  })
  .strict()
  .refine(
    (v) => !!v.settings !== !!v.profileId,
    "Provide settings or profileId",
  );
export type CreateSession = z.infer<typeof createSessionSchema>;
export const sessionDtoSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    protocol: z.literal("ssh"),
    state: sessionStateSchema,
    host: z.string(),
    port: z.number(),
    username: z.string(),
    capabilities: capabilitiesSchema,
    terminal: terminalOptionsSchema.optional(),
    profileId: idSchema.optional(),
    workspaceEntryId: idSchema.optional(),
    workspaceId: idSchema.optional(),
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        details: z.record(z.string()).optional(),
      })
      .optional(),
  })
  .strict();
export type SessionDto = z.infer<typeof sessionDtoSchema>;
export const loginSchema = z
  .object({
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const userSchema = z
  .object({
    id: idSchema,
    username: z.string(),
    role: z.enum(["admin", "user"]),
  })
  .strict();
export type User = z.infer<typeof userSchema>;
export const terminalAppearanceSchema = z
  .object({
    palette: z.enum(["classic", "solarized-dark"]).default("classic"),
    fontSize: z.number().int().min(10).max(28).default(13),
    cursorStyle: z.enum(["block", "underline", "bar"]).default("block"),
  })
  .strict();
export const preferencesSchema = z
  .object({
    theme: z.enum(["classic-light", "classic-dark"]).default("classic-light"),
    sidebarWidth: z.number().int().min(180).max(500).default(260),
    sidebarVisible: z.boolean().default(true),
    appearance: terminalAppearanceSchema.default({}),
    terminal: terminalOptionsSchema.default({}),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const folderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    parentId: idSchema.nullable().default(null),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export const folderSchema = folderInputSchema.extend({ id: idSchema });
export type Folder = z.infer<typeof folderSchema>;
export const workspaceLayoutSchema = z
  .object({
    version: z.literal(1),
    layout: z.enum(["single", "horizontal", "vertical", "grid"]),
    entries: z
      .array(
        z
          .object({
            id: idSchema,
            profileId: idSchema,
            pane: z.number().int().min(0).max(3).nullable(),
          })
          .strict(),
      )
      .max(32),
    activeEntryId: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const panes = new Set<number>();
    const count =
      value.layout === "single" ? 1 : value.layout === "grid" ? 4 : 2;
    for (const entry of value.entries) {
      if (ids.has(entry.id))
        context.addIssue({
          code: "custom",
          message: "Duplicate workspace entry",
        });
      ids.add(entry.id);
      if (entry.pane !== null) {
        if (entry.pane >= count || panes.has(entry.pane))
          context.addIssue({
            code: "custom",
            message: "Invalid or duplicate visible pane",
          });
        panes.add(entry.pane);
      }
    }
    if (value.activeEntryId !== null && !ids.has(value.activeEntryId))
      context.addIssue({
        code: "custom",
        message: "Active workspace entry is missing",
      });
  });
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;
export const workspaceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    layout: workspaceLayoutSchema,
  })
  .strict();
export const workspaceSchema = workspaceInputSchema.extend({ id: idSchema });
export type Workspace = z.infer<typeof workspaceSchema>;
export const credentialInputSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    material: authMaterialSchema,
  })
  .strict();
export const credentialDtoSchema = z
  .object({ id: idSchema, name: z.string(), type: z.enum(["password", "key"]) })
  .strict();
export type CredentialDto = z.infer<typeof credentialDtoSchema>;
export const trustSchema = z
  .object({
    id: idSchema,
    host: z.string(),
    port: z.number(),
    algorithm: z.string(),
    fingerprint: z.string(),
    firstSeenAt: z.string(),
    lastVerifiedAt: z.string(),
  })
  .strict();
export type TrustDto = z.infer<typeof trustSchema>;
export const attachSchema = z
  .object({
    sessionId: idSchema,
    afterSequence: z.number().int().min(0).optional(),
  })
  .strict();
export const sessionIdSchema = z.object({ sessionId: idSchema }).strict();
export const inputSchema = sessionIdSchema.extend({
  data: z.string().max(65536),
});
export const resizeSchema = sessionIdSchema.extend({
  columns: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
});
export const hostKeyDecisionSchema = sessionIdSchema.extend({
  requestId: idSchema,
  accept: z.boolean(),
  save: z.boolean().default(false),
});
export const authResponseMaterialSchema = z.union([
  authMaterialSchema,
  z
    .object({
      type: z.literal("passphrase"),
      passphrase: z.string().max(16384),
    })
    .strict(),
]);
export type AuthResponseMaterial = z.infer<typeof authResponseMaterialSchema>;
export const authResponseSchema = sessionIdSchema.extend({
  requestId: idSchema,
  credential: authResponseMaterialSchema,
});
export interface HostKeyRequest {
  sessionId: string;
  requestId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}
export interface AuthRequest {
  sessionId: string;
  requestId: string;
  methods: ("password" | "key" | "passphrase")[];
}
export interface OutputFrame {
  sessionId: string;
  sequence: number;
  data: Uint8Array;
}
export interface Replay {
  sessionId: string;
  reset: boolean;
  truncated: boolean;
  frames: OutputFrame[];
}
export type SocketReply<T = undefined> =
  { ok: true; data?: T } | { ok: false; error: ApiError };
export interface ServerEvents {
  "auth:invalidated": (error: ApiError) => void;
  "session:state": (session: SessionDto) => void;
  "terminal:data": (frame: OutputFrame) => void;
  "session:replay": (replay: Replay) => void;
  "hostkey:request": (request: HostKeyRequest) => void;
  "auth:request": (request: AuthRequest) => void;
  "session:replaced": (data: { sessionId: string }) => void;
}

export const trustImportSchema = z
  .object({
    host: sshSettingsSchema.shape.host,
    port: z.number().int().min(1).max(65535).default(22),
    publicKey: z.string().trim().min(1).max(16384),
  })
  .strict();
export type TrustImport = z.infer<typeof trustImportSchema>;
export const authRequestSchema = z
  .object({
    sessionId: idSchema,
    requestId: idSchema,
    methods: z.array(z.enum(["password", "key", "passphrase"])).min(1),
  })
  .strict();
export const hostKeyRequestSchema = z
  .object({
    sessionId: idSchema,
    requestId: idSchema,
    host: z.string(),
    port: z.number(),
    algorithm: z.string(),
    fingerprint: z.string(),
  })
  .strict();
export const meSchema = z
  .object({ user: userSchema, csrfToken: z.string() })
  .strict();
/** Parse supported SSH notation without invoking a shell or accepting arbitrary flags. */
export function parseQuickConnect(
  input: string,
  defaults: { username?: string; terminal?: SshSettings["terminal"] } = {},
): SshSettings {
  const text = input.trim().replace(/^ssh\s+/, "");
  const match =
    /^(?:([^\s@]+)@)?(\[[0-9a-fA-F:.]+\]|[^\s:@[\]]+)(?::([0-9]+))?$/.exec(
      text,
    );
  if (!match)
    throw new Error(
      "Use ssh user@host or user@host:port; bracket IPv6 addresses",
    );
  const username = match[1] ?? defaults.username;
  if (!username) throw new Error("Enter an SSH username");
  return sshSettingsSchema.parse({
    host: match[2]!.replace(/^\[|\]$/g, ""),
    port: match[3] ? Number(match[3]) : 22,
    username,
    ...(defaults.terminal ? { terminal: defaults.terminal } : {}),
  });
}

export const workspaceRestoreSchema = z
  .object({
    workspace: workspaceSchema,
    entries: z.array(
      z
        .object({
          entryId: idSchema,
          session: sessionDtoSchema.optional(),
          error: apiErrorSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const groupLaunchSchema = z
  .object({
    entries: z.array(
      z
        .object({
          profileId: idSchema,
          session: sessionDtoSchema.optional(),
          error: apiErrorSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const sessionWorkspaceSchema = z
  .object({ workspaceId: idSchema, workspaceEntryId: idSchema })
  .strict();

export const broadcastActivationSchema = z
  .object({ enabled: z.boolean(), sessionIds: z.array(idSchema).max(32) })
  .strict();

export const sessionProfileSchema = z.object({ profileId: idSchema }).strict();
