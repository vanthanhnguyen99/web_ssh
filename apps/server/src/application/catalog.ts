import type {
  Preferences,
  ProfileInput,
  AuthMaterial,
  Folder,
  Workspace,
} from "@workspace/shared";
import type {
  CatalogRepository,
  CredentialStore,
  Principal,
} from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
/** Resource ownership is implemented by repositories; services validate cross-resource references. */
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly credentials: CredentialStore,
  ) {}
  profiles(principal: Principal) {
    return this.repository.listProfiles(principal.user.id);
  }
  async putProfile(principal: Principal, input: ProfileInput, id?: string) {
    if (
      input.credentialId &&
      !(await this.credentials.list(principal.user.id)).some(
        (c) => c.id === input.credentialId,
      )
    )
      throw new DomainError("NOT_FOUND", "Credential not found", 404);
    if (
      input.folderId &&
      !(await this.repository.listFolders(principal.user.id)).some(
        (f) => f.id === input.folderId,
      )
    )
      throw new DomainError("NOT_FOUND", "Folder not found", 404);
    return this.repository.putProfile(principal.user.id, input, id);
  }
  deleteProfile(principal: Principal, id: string) {
    return this.repository.deleteProfile(principal.user.id, id);
  }
  listCredentials(principal: Principal) {
    return this.credentials.list(principal.user.id);
  }
  putCredential(
    principal: Principal,
    input: { name: string; material: AuthMaterial },
    id?: string,
  ) {
    return this.credentials.put(
      principal.user.id,
      input.name,
      input.material,
      id,
    );
  }
  async deleteCredential(principal: Principal, id: string) {
    // Leave profile references explicit: missing credentials fail rather than silently downgrading authentication.
    await this.credentials.delete(principal.user.id, id);
  }
  private readonly folderLocks = new Map<string, Promise<unknown>>();
  folders(principal: Principal) {
    return this.repository.listFolders(principal.user.id);
  }
  private async serialFolder<T>(
    owner: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.folderLocks.get(owner) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.folderLocks.set(owner, next);
    try {
      return await next;
    } finally {
      if (this.folderLocks.get(owner) === next) this.folderLocks.delete(owner);
    }
  }
  putFolder(principal: Principal, input: Omit<Folder, "id">, id?: string) {
    return this.serialFolder(principal.user.id, async () => {
      const folders = await this.folders(principal);
      if (id && !folders.some((f) => f.id === id))
        throw new DomainError("NOT_FOUND", "Folder not found", 404);
      let parent = input.parentId;
      const visited = new Set<string>();
      while (parent) {
        if (parent === id || visited.has(parent))
          throw new DomainError(
            "INVALID_REQUEST",
            "Folder would create a cycle",
          );
        visited.add(parent);
        const node = folders.find((f) => f.id === parent);
        if (!node)
          throw new DomainError("NOT_FOUND", "Parent folder not found", 404);
        parent = node.parentId;
      }
      return this.repository.putFolder(principal.user.id, input, id);
    });
  }
  deleteFolder(principal: Principal, id: string) {
    return this.serialFolder(principal.user.id, async () => {
      if (!(await this.folders(principal)).some((f) => f.id === id))
        throw new DomainError("NOT_FOUND", "Folder not found", 404);
      return this.repository.deleteFolder(principal.user.id, id);
    });
  }
  workspaces(principal: Principal) {
    return this.repository.listWorkspaces(principal.user.id);
  }
  async workspace(principal: Principal, id: string) {
    const workspace = (await this.workspaces(principal)).find(
      (w) => w.id === id,
    );
    if (!workspace)
      throw new DomainError("NOT_FOUND", "Workspace not found", 404);
    return workspace;
  }
  async putWorkspace(
    principal: Principal,
    input: Omit<Workspace, "id">,
    id?: string,
  ) {
    const profiles = await this.profiles(principal);
    for (const entry of input.layout.entries)
      if (!profiles.some((p) => p.id === entry.profileId))
        throw new DomainError("NOT_FOUND", "Workspace profile not found", 404);
    return this.repository.putWorkspace(principal.user.id, input, id);
  }
  async deleteWorkspace(principal: Principal, id: string) {
    await this.workspace(principal, id);
    return this.repository.deleteWorkspace(principal.user.id, id);
  }
  preferences(principal: Principal) {
    return this.repository.getPreferences(principal.user.id);
  }
  putPreferences(principal: Principal, input: Preferences) {
    return this.repository.putPreferences(principal.user.id, input);
  }
}
