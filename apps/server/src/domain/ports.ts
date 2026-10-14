import type {
  AuthMaterial,
  CredentialDto,
  Folder,
  Preferences,
  Profile,
  ProfileInput,
  ProtocolCapabilities,
  SessionDto,
  SshSettings,
  TrustDto,
  User,
  Workspace,
} from "@workspace/shared";
export interface Principal {
  user: User;
  webSessionId: string;
  expiresAt: number;
  csrfToken: string;
}
export interface IdentityProvider {
  authenticate(username: string, password: string): Promise<User | null>;
}
export interface AuthRepository {
  createSession(
    tokenHash: string,
    userId: string,
    csrf: string,
    expires: Date,
  ): Promise<string>;
  getSession(tokenHash: string): Promise<Principal | null>;
  deleteSession(id: string): Promise<void>;
  expiredSessionIds(): Promise<string[]>;
}
export interface AuthorizationService {
  owned(ownerId: string, actorId: string): void;
}
export interface Target {
  host: string;
  address: string;
  port: number;
}
export interface TargetPolicy {
  resolve(host: string, port: number): Promise<Target>;
}
export interface CredentialStore {
  list(ownerId: string): Promise<CredentialDto[]>;
  put(
    ownerId: string,
    name: string,
    material: AuthMaterial,
    id?: string,
  ): Promise<CredentialDto>;
  get(ownerId: string, id: string): Promise<AuthMaterial>;
  delete(ownerId: string, id: string): Promise<void>;
}
export interface TrustedKey extends TrustDto {
  ownerId: string;
  publicKey: string;
}
export interface TrustRepository {
  find(ownerId: string, host: string, port: number): Promise<TrustedKey | null>;
  save(key: TrustedKey): Promise<boolean>;
  verified(id: string): Promise<void>;
  list(ownerId: string): Promise<TrustDto[]>;
  delete(ownerId: string, id: string): Promise<void>;
}
export interface CatalogRepository {
  listProfiles(ownerId: string): Promise<Profile[]>;
  getProfile(ownerId: string, id: string): Promise<Profile | null>;
  putProfile(
    ownerId: string,
    profile: ProfileInput,
    id?: string,
  ): Promise<Profile>;
  deleteProfile(ownerId: string, id: string): Promise<void>;
  listFolders(ownerId: string): Promise<Folder[]>;
  putFolder(
    ownerId: string,
    folder: Omit<Folder, "id">,
    id?: string,
  ): Promise<Folder>;
  deleteFolder(ownerId: string, id: string): Promise<void>;
  listWorkspaces(ownerId: string): Promise<Workspace[]>;
  putWorkspace(
    ownerId: string,
    workspace: Omit<Workspace, "id">,
    id?: string,
  ): Promise<Workspace>;
  deleteWorkspace(ownerId: string, id: string): Promise<void>;
  getPreferences(ownerId: string): Promise<Preferences>;
  putPreferences(
    ownerId: string,
    preferences: Preferences,
  ): Promise<Preferences>;
}
export interface AuditRepository {
  record(
    userId: string,
    type: string,
    target: string,
    metadata?: Record<string, string>,
  ): Promise<void>;
}
export interface TerminalChannel {
  /** Returns false only when the bounded queue rejects input; stream backpressure is internal. */ write(
    data: string,
  ): boolean;
  resize(columns: number, rows: number): void;
  close(): void;
  onData(callback: (data: Uint8Array) => void): () => void;
  onClose(callback: () => void): () => void;
}
export interface ProtocolConnection {
  capabilities: ProtocolCapabilities;
  terminal?: TerminalChannel;
  close(): void;
}
export interface ConnectContext<TSettings> {
  target: Target;
  settings: TSettings;
  signal: AbortSignal;
}
export interface SshConnectContext extends ConnectContext<SshSettings> {
  verifyHostKey(key: Uint8Array): Promise<boolean>;
  authenticate(): Promise<AuthMaterial>;
  authenticating(): void;
  requestPassphrase(): Promise<string>;
}
export interface ProtocolAdapter<TContext = ConnectContext<unknown>> {
  readonly protocol: string;
  readonly capabilities: ProtocolCapabilities;
  connect(context: TContext): Promise<ProtocolConnection>;
}
export interface SessionRegistry {
  list(ownerId: string): SessionDto[];
  closeByWebSession(webSessionId: string): void;
  shutdown(): void;
}
