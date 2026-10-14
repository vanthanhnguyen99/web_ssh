import type { Principal } from "../domain/ports.js";
import { DomainError, publicError } from "../domain/errors.js";
import type { CatalogService } from "./catalog.js";
import type { SshSessionService } from "./sessions.js";
/** Workspace configuration stays durable; live session association stays in the registry. */
export class WorkspaceService {
  private readonly restores = new Map<string, Promise<unknown>>();
  constructor(
    private readonly catalog: CatalogService,
    private readonly sessions: SshSessionService,
  ) {}
  async restore(principal: Principal, id: string) {
    const key = `${principal.user.id}:${id}`;
    const previous = this.restores.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const workspace = await this.catalog.workspace(principal, id);
        const entries = [];
        for (const entry of workspace.layout.entries) {
          try {
            const existing = this.sessions.manager
              .list(principal.user.id)
              .find(
                (s) =>
                  s.workspaceId === id &&
                  s.workspaceEntryId === entry.id &&
                  s.profileId === entry.profileId &&
                  s.state !== "CLOSED" &&
                  s.state !== "FAILED",
              );
            const session =
              existing ??
              (await this.sessions.create(principal, {
                protocol: "ssh",
                profileId: entry.profileId,
                workspaceId: id,
                workspaceEntryId: entry.id,
              }));
            entries.push({ entryId: entry.id, session });
          } catch (error) {
            entries.push({ entryId: entry.id, error: publicError(error) });
          }
        }
        return { workspace, entries };
      });
    this.restores.set(key, next);
    try {
      return await next;
    } finally {
      if (this.restores.get(key) === next) this.restores.delete(key);
    }
  }
  async launchFolder(principal: Principal, id: string) {
    const folders = await this.catalog.folders(principal);
    if (!folders.some((f) => f.id === id))
      throw new DomainError("NOT_FOUND", "Folder not found", 404);
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of folders)
        if (
          f.parentId &&
          descendants.has(f.parentId) &&
          !descendants.has(f.id)
        ) {
          descendants.add(f.id);
          changed = true;
        }
    }
    const profiles = (await this.catalog.profiles(principal)).filter(
      (p) => p.folderId && descendants.has(p.folderId),
    );
    const entries = [];
    for (const profile of profiles) {
      try {
        entries.push({
          profileId: profile.id,
          session: await this.sessions.create(principal, {
            protocol: profile.protocol,
            profileId: profile.id,
          }),
        });
      } catch (error) {
        entries.push({ profileId: profile.id, error: publicError(error) });
      }
    }
    return { entries };
  }
}
