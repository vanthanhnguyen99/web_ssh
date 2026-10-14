import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Folder,
  Preferences,
  ProfileInput,
  WorkspaceLayout,
} from "@workspace/shared";
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const webSessions = pgTable("web_sessions", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  csrf: text("csrf").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ciphertext: text("ciphertext").notNull(),
});
export const profiles = pgTable("connection_profiles", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ProfileInput>().notNull(),
});
export const folders = pgTable("folders", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Omit<Folder, "id">>().notNull(),
});
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  layout: jsonb("layout").$type<WorkspaceLayout>().notNull(),
});
export const preferences = pgTable("preferences", {
  ownerId: uuid("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Preferences>().notNull(),
});
export const trustedKeys = pgTable(
  "trusted_host_keys",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    algorithm: text("algorithm").notNull(),
    fingerprint: text("fingerprint").notNull(),
    publicKey: text("public_key").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("trusted_host_target").on(
      table.ownerId,
      table.host,
      table.port,
    ),
  ],
);
export const audits = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  target: text("target").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
