import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { verify } from "argon2";
import {
  folderSchema,
  preferencesSchema,
  profileSchema,
  trustSchema,
  userSchema,
  workspaceSchema,
  type Folder,
  type Preferences,
  type ProfileInput,
  type Workspace,
} from "@workspace/shared";
import type {
  AuthRepository,
  AuditRepository,
  CatalogRepository,
  IdentityProvider,
  TrustRepository,
  TrustedKey,
} from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
import type { Database } from "./database.js";
import {
  audits,
  folders,
  preferences,
  profiles,
  trustedKeys,
  users,
  webSessions,
  workspaces,
} from "./schema.js";
export class LocalIdentityProvider implements IdentityProvider {
  constructor(
    private readonly db: Database,
    private readonly dummyHash: string,
  ) {}
  async authenticate(username: string, password: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username));
    const matches = await verify(
      user?.passwordHash ?? this.dummyHash,
      password,
    );
    return user && matches
      ? userSchema.parse({
          id: user.id,
          username: user.username,
          role: user.role,
        })
      : null;
  }
}
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Database) {}
  async createSession(
    tokenHash: string,
    userId: string,
    csrf: string,
    expiresAt: Date,
  ) {
    const id = randomUUID();
    await this.db
      .insert(webSessions)
      .values({ id, tokenHash, userId, csrf, expiresAt });
    return id;
  }
  async getSession(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(webSessions)
      .innerJoin(users, eq(webSessions.userId, users.id))
      .where(eq(webSessions.tokenHash, tokenHash));
    return row
      ? {
          user: userSchema.parse({
            id: row.users.id,
            username: row.users.username,
            role: row.users.role,
          }),
          webSessionId: row.web_sessions.id,
          csrfToken: row.web_sessions.csrf,
          expiresAt: row.web_sessions.expiresAt.getTime(),
        }
      : null;
  }
  async deleteSession(id: string) {
    await this.db.delete(webSessions).where(eq(webSessions.id, id));
  }
  async expiredSessionIds() {
    const rows = await this.db
      .select({ id: webSessions.id })
      .from(webSessions)
      .where(lt(webSessions.expiresAt, new Date()));
    return rows.map((r) => r.id);
  }
}
export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}
  async record(
    userId: string,
    type: string,
    target: string,
    metadata: Record<string, string> = {},
  ) {
    await this.db
      .insert(audits)
      .values({ id: randomUUID(), userId, type, target, metadata });
  }
}
export class PostgresTrustRepository implements TrustRepository {
  constructor(private readonly db: Database) {}
  async find(
    ownerId: string,
    host: string,
    port: number,
  ): Promise<TrustedKey | null> {
    const [row] = await this.db
      .select()
      .from(trustedKeys)
      .where(
        and(
          eq(trustedKeys.ownerId, ownerId),
          eq(trustedKeys.host, host),
          eq(trustedKeys.port, port),
        ),
      );
    return row
      ? {
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastVerifiedAt: row.lastVerifiedAt.toISOString(),
        }
      : null;
  }
  async save(key: TrustedKey) {
    const rows = await this.db
      .insert(trustedKeys)
      .values({
        ...key,
        firstSeenAt: new Date(key.firstSeenAt),
        lastVerifiedAt: new Date(key.lastVerifiedAt),
      })
      .onConflictDoNothing()
      .returning({ id: trustedKeys.id });
    return !!rows.length;
  }
  async verified(id: string) {
    await this.db
      .update(trustedKeys)
      .set({ lastVerifiedAt: new Date() })
      .where(eq(trustedKeys.id, id));
  }
  async list(ownerId: string) {
    const rows = await this.db
      .select()
      .from(trustedKeys)
      .where(eq(trustedKeys.ownerId, ownerId));
    return rows.map((row) =>
      trustSchema.parse({
        id: row.id,
        host: row.host,
        port: row.port,
        algorithm: row.algorithm,
        fingerprint: row.fingerprint,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastVerifiedAt: row.lastVerifiedAt.toISOString(),
      }),
    );
  }
  async delete(ownerId: string, id: string) {
    await this.db
      .delete(trustedKeys)
      .where(and(eq(trustedKeys.ownerId, ownerId), eq(trustedKeys.id, id)));
  }
}
export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Database) {}
  async listProfiles(ownerId: string) {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.ownerId, ownerId));
    return rows.map((row) => profileSchema.parse({ ...row.data, id: row.id }));
  }
  async getProfile(ownerId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.ownerId, ownerId), eq(profiles.id, id)));
    return row ? profileSchema.parse({ ...row.data, id: row.id }) : null;
  }
  async putProfile(ownerId: string, data: ProfileInput, id?: string) {
    const target = id ?? randomUUID();
    if (id) {
      const rows = await this.db
        .update(profiles)
        .set({ data })
        .where(and(eq(profiles.ownerId, ownerId), eq(profiles.id, id)))
        .returning();
      if (!rows.length)
        throw new DomainError("NOT_FOUND", "Profile not found", 404);
    } else await this.db.insert(profiles).values({ id: target, ownerId, data });
    return profileSchema.parse({ id: target, ...data });
  }
  async deleteProfile(ownerId: string, id: string) {
    await this.db
      .delete(profiles)
      .where(and(eq(profiles.ownerId, ownerId), eq(profiles.id, id)));
  }
  async listFolders(ownerId: string) {
    const rows = await this.db
      .select()
      .from(folders)
      .where(eq(folders.ownerId, ownerId));
    return rows.map((row) => folderSchema.parse({ id: row.id, ...row.data }));
  }
  async putFolder(ownerId: string, data: Omit<Folder, "id">, id?: string) {
    const target = id ?? randomUUID();
    if (id) {
      const rows = await this.db
        .update(folders)
        .set({ data })
        .where(and(eq(folders.ownerId, ownerId), eq(folders.id, id)))
        .returning();
      if (!rows.length)
        throw new DomainError("NOT_FOUND", "Folder not found", 404);
    } else await this.db.insert(folders).values({ id: target, ownerId, data });
    return folderSchema.parse({ id: target, ...data });
  }
  async deleteFolder(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      // Keep children and profiles usable after deleting their folder.
      const children = await tx
        .select()
        .from(folders)
        .where(eq(folders.ownerId, ownerId));
      for (const row of children)
        if (row.data.parentId === id)
          await tx
            .update(folders)
            .set({ data: { ...row.data, parentId: null } })
            .where(eq(folders.id, row.id));
      const ownedProfiles = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.ownerId, ownerId));
      for (const row of ownedProfiles)
        if (row.data.folderId === id)
          await tx
            .update(profiles)
            .set({ data: { ...row.data, folderId: null } })
            .where(eq(profiles.id, row.id));
      await tx
        .delete(folders)
        .where(and(eq(folders.ownerId, ownerId), eq(folders.id, id)));
    });
  }
  async listWorkspaces(ownerId: string) {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, ownerId));
    return rows.map((row) =>
      workspaceSchema.parse({ id: row.id, name: row.name, layout: row.layout }),
    );
  }
  async putWorkspace(
    ownerId: string,
    data: Omit<Workspace, "id">,
    id?: string,
  ) {
    const target = id ?? randomUUID();
    if (id) {
      const rows = await this.db
        .update(workspaces)
        .set(data)
        .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.id, id)))
        .returning();
      if (!rows.length)
        throw new DomainError("NOT_FOUND", "Workspace not found", 404);
    } else
      await this.db.insert(workspaces).values({ id: target, ownerId, ...data });
    return workspaceSchema.parse({ id: target, ...data });
  }
  async deleteWorkspace(ownerId: string, id: string) {
    await this.db
      .delete(workspaces)
      .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.id, id)));
  }
  async getPreferences(ownerId: string) {
    const [row] = await this.db
      .select()
      .from(preferences)
      .where(eq(preferences.ownerId, ownerId));
    return preferencesSchema.parse(row?.data ?? {});
  }
  async putPreferences(ownerId: string, data: Preferences) {
    await this.db
      .insert(preferences)
      .values({ ownerId, data })
      .onConflictDoUpdate({ target: preferences.ownerId, set: { data } });
    return data;
  }
}
