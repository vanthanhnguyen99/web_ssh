import { create } from "zustand";
import {
  profileSchema,
  folderSchema,
  workspaceSchema,
  type Folder,
  type Workspace,
  credentialDtoSchema,
  trustSchema,
  preferencesSchema,
  type Profile,
  type CredentialDto,
  type TrustDto,
  type Preferences,
} from "@workspace/shared";
import { api } from "./api";
import { useWorkspace } from "./store";
import { currentOperation } from "./operation";
interface Catalog {
  profiles: Profile[];
  folders: Folder[];
  workspaces: Workspace[];
  credentials: CredentialDto[];
  trust: TrustDto[];
  preferences: Preferences;
  loaded: boolean;
  refresh(): Promise<void>;
  savePreferences(value: Preferences): Promise<void>;
  reset(): void;
}
const defaults = () => preferencesSchema.parse({});
// Durable configuration lives on the server. No credentials or session material enter this store.
export const useCatalog = create<Catalog>((set) => ({
  profiles: [],
  folders: [],
  workspaces: [],
  credentials: [],
  trust: [],
  preferences: defaults(),
  loaded: false,
  async refresh() {
    const current = currentOperation();
    const [profiles, credentials, trust, preferences, folders, workspaces] =
      await Promise.all([
        api("/profiles", {}, profileSchema.array()),
        api("/credentials", {}, credentialDtoSchema.array()),
        api("/host-keys", {}, trustSchema.array()),
        api("/preferences", {}, preferencesSchema),
        api("/folders", {}, folderSchema.array()),
        api("/workspaces", {}, workspaceSchema.array()),
      ]);
    if (!current()) return;
    set({
      profiles,
      credentials,
      trust,
      preferences,
      folders,
      workspaces,
      loaded: true,
    });
    useWorkspace.setState({ theme: preferences.theme });
  },
  async savePreferences(value) {
    const current = currentOperation();
    const preferences = await api(
      "/preferences",
      { method: "PUT", body: preferencesSchema.parse(value) },
      preferencesSchema,
    );
    if (!current()) return;
    set({ preferences });
    useWorkspace.setState({ theme: preferences.theme });
  },
  reset() {
    set({
      profiles: [],
      folders: [],
      workspaces: [],
      credentials: [],
      trust: [],
      preferences: defaults(),
      loaded: false,
    });
  },
}));
