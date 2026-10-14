import type {
  AuthMaterial,
  AuthResponseMaterial,
  CreateSession,
} from "@workspace/shared";
import type {
  CatalogRepository,
  CredentialStore,
  AuditRepository,
  Principal,
  ProtocolAdapter,
  SshConnectContext,
  TargetPolicy,
} from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
import { SessionManager } from "./session-manager.js";
import { HostTrustService } from "./host-trust.js";
import { ConnectionGate } from "./connection-gate.js";
import { WindowRateLimiter } from "./auth.js";
export class SshSessionService {
  private readonly sources = new Map<
    string,
    {
      ownerId: string;
      webSessionId: string;
      expiresAt: number;
      input: CreateSession;
    }
  >();
  reconnect(principal: Principal, id: string) {
    const source = this.sources.get(id);
    if (!source || source.expiresAt <= Date.now())
      throw new DomainError(
        "NOT_FOUND",
        "Reconnect settings expired; connect again",
        404,
      );
    if (source.ownerId !== principal.user.id)
      throw new DomainError(
        "SESSION_NOT_OWNED",
        "Session belongs to another user",
        403,
      );
    // A reconnect replaces the old transport and obtains fresh session-only credentials.
    if (this.manager.list(principal.user.id).some((s) => s.id === id))
      this.manager.close(principal, id);
    this.reconnected++;
    return this.create(principal, source.input);
  }
  duplicate(principal: Principal, id: string) {
    const source = this.sources.get(id);
    if (!source || source.expiresAt <= Date.now())
      throw new DomainError(
        "NOT_FOUND",
        "Session settings expired; connect again",
        404,
      );
    if (source.ownerId !== principal.user.id)
      throw new DomainError(
        "SESSION_NOT_OWNED",
        "Session belongs to another user",
        403,
      );
    const {
      workspaceId: _workspaceId,
      workspaceEntryId: _workspaceEntryId,
      ...input
    } = source.input;
    void _workspaceId;
    void _workspaceEntryId;
    return this.create(principal, input);
  }
  private readonly attempts: WindowRateLimiter;
  private readonly gate = new ConnectionGate(4);
  private attempted = 0;
  private reconnected = 0;
  private broadcastActivations = 0;
  metrics() {
    return { connectionAttempts: this.attempted, reconnects: this.reconnected };
  }
  constructor(
    readonly manager: SessionManager,
    private readonly protocols: ReadonlyMap<
      string,
      ProtocolAdapter<SshConnectContext>
    >,
    private readonly policy: TargetPolicy,
    private readonly catalog: CatalogRepository,
    private readonly credentials: CredentialStore,
    readonly trust: HostTrustService,
    attemptsPerMinute = 120,
    private readonly audit?: AuditRepository,
  ) {
    this.attempts = new WindowRateLimiter(attemptsPerMinute, 60000);
    manager.onAttachment((id, principal) => {
      const source = this.sources.get(id);
      if (source) {
        source.webSessionId = principal.webSessionId;
        source.expiresAt = principal.expiresAt;
      }
    });
    manager.onRevocation((webSessionId) => {
      for (const [id, source] of this.sources)
        if (!webSessionId || source.webSessionId === webSessionId)
          this.sources.delete(id);
    });
  }
  async profileDraft(principal: Principal, id: string) {
    const source = this.sources.get(id);
    const session = this.manager
      .list(principal.user.id)
      .find((s) => s.id === id);
    if (
      !source ||
      !session ||
      source.ownerId !== principal.user.id ||
      source.expiresAt <= Date.now()
    )
      throw new DomainError(
        "NOT_FOUND",
        "Session settings expired; connect again",
        404,
      );
    const profile = source.input.profileId
      ? await this.catalog.getProfile(principal.user.id, source.input.profileId)
      : null;
    const settings = profile?.settings ?? source.input.settings;
    if (!settings)
      throw new DomainError(
        "NOT_FOUND",
        "Profile settings no longer exist",
        404,
      );
    return {
      protocol: "ssh" as const,
      name: session.name,
      settings,
      folderId: null,
      credentialId: null,
    };
  }
  async promoteProfile(principal: Principal, id: string, profileId: string) {
    const profile = await this.catalog.getProfile(principal.user.id, profileId);
    const session = this.manager
      .list(principal.user.id)
      .find((s) => s.id === id);
    if (!profile || !session)
      throw new DomainError("NOT_FOUND", "Session or profile not found", 404);
    if (
      profile.settings.host !== session.host ||
      profile.settings.port !== session.port ||
      profile.settings.username !== session.username
    )
      throw new DomainError(
        "INVALID_REQUEST",
        "Saved profile target must match the live session",
      );
    if (session.profileId)
      throw new DomainError("INVALID_REQUEST", "Session already has a profile");
    const updated = this.manager.promoteProfile(
      principal,
      id,
      profileId,
      profile.name,
    );
    const source = this.sources.get(id);
    if (source) source.input = { protocol: "ssh", profileId };
    return updated;
  }
  async auditBroadcast(
    principal: Principal,
    enabled: boolean,
    sessionIds: string[],
  ) {
    const owned = this.manager.list(principal.user.id);
    for (const id of sessionIds)
      if (!owned.some((s) => s.id === id))
        throw new DomainError(
          "SESSION_NOT_OWNED",
          "Broadcast session is not owned",
          403,
        );
    await this.audit?.record(
      principal.user.id,
      "broadcast.activation",
      principal.webSessionId,
      {
        enabled: String(enabled),
        targetCount: String(new Set(sessionIds).size),
      },
    );
    if (enabled) this.broadcastActivations++;
    return { ok: true };
  }
  async associateWorkspace(
    principal: Principal,
    sessionId: string,
    workspaceId: string,
    workspaceEntryId: string,
  ) {
    const session = this.manager
      .list(principal.user.id)
      .find((s) => s.id === sessionId);
    if (!session) throw new DomainError("NOT_FOUND", "Session not found", 404);
    const workspace = (
      await this.catalog.listWorkspaces(principal.user.id)
    ).find((w) => w.id === workspaceId);
    const entry = workspace?.layout.entries.find(
      (e) => e.id === workspaceEntryId,
    );
    if (!entry || entry.profileId !== session.profileId)
      throw new DomainError(
        "INVALID_REQUEST",
        "Workspace entry does not match session profile",
      );
    for (const other of this.manager.list(principal.user.id)) {
      if (
        other.id !== sessionId &&
        other.workspaceId === workspaceId &&
        other.workspaceEntryId === workspaceEntryId
      ) {
        const oldSource = this.sources.get(other.id);
        if (oldSource) {
          delete oldSource.input.workspaceId;
          delete oldSource.input.workspaceEntryId;
        }
      }
    }
    const source = this.sources.get(sessionId);
    if (source)
      source.input = { ...source.input, workspaceId, workspaceEntryId };
    return this.manager.associateWorkspace(
      principal,
      sessionId,
      workspaceId,
      workspaceEntryId,
    );
  }
  async create(principal: Principal, input: CreateSession) {
    this.attempts.take(principal.user.id);
    this.attempted++;
    const lease = this.manager.reserve(principal);
    try {
      const profile = input.profileId
        ? await this.catalog.getProfile(principal.user.id, input.profileId)
        : null;
      if (input.profileId && !profile)
        throw new DomainError("NOT_FOUND", "Profile not found", 404);
      if (input.workspaceId || input.workspaceEntryId) {
        const workspace = (
          await this.catalog.listWorkspaces(principal.user.id)
        ).find((w) => w.id === input.workspaceId);
        const entry = workspace?.layout.entries.find(
          (e) => e.id === input.workspaceEntryId,
        );
        if (!entry || entry.profileId !== profile?.id)
          throw new DomainError(
            "INVALID_REQUEST",
            "Workspace entry does not match profile",
          );
      }
      const settings = profile?.settings ?? input.settings!;
      const adapter = this.protocols.get(profile?.protocol ?? input.protocol);
      if (!adapter)
        throw new DomainError(
          "AUTH_METHOD_UNSUPPORTED",
          "Protocol is not registered",
        );
      const target = await this.policy.resolve(settings.host, settings.port);
      lease.assertActive();
      // Credential is held only by the pending connection closure, never by session DTO/state.
      let credential: AuthMaterial | undefined = input.credential;
      const session = this.manager.create(
        principal,
        {
          name: profile?.name ?? `${settings.username}@${settings.host}`,
          protocol: "ssh",
          host: settings.host,
          port: settings.port,
          username: settings.username,
          capabilities: adapter.capabilities,
          terminal: settings.terminal,
          ...(profile ? { profileId: profile.id } : {}),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.workspaceEntryId
            ? { workspaceEntryId: input.workspaceEntryId }
            : {}),
        },
        async (context) => {
          try {
            return await this.gate.run(context.signal, () =>
              adapter.connect({
                target,
                settings,
                signal: context.signal,
                authenticating: () => context.state("AUTHENTICATING"),
                verifyHostKey: (key) =>
                  this.trust.verify(
                    principal.user.id,
                    context.id,
                    settings,
                    key,
                    async (request) => {
                      context.state("HOST_KEY_PENDING");
                      return context.prompt("hostkey:request", { ...request });
                    },
                  ),
                requestPassphrase: async () => {
                  const response = await context.prompt<AuthResponseMaterial>(
                    "auth:request",
                    { methods: ["passphrase"] },
                  );
                  if (response.type !== "passphrase")
                    throw new DomainError(
                      "INVALID_REQUEST",
                      "This key requires a passphrase response",
                    );
                  return response.passphrase;
                },
                authenticate: async () => {
                  if (credential) return credential;
                  if (profile?.credentialId)
                    return this.credentials.get(
                      principal.user.id,
                      profile.credentialId,
                    );
                  const response = await context.prompt<AuthResponseMaterial>(
                    "auth:request",
                    { methods: ["password", "key"] },
                  );
                  if (response.type === "passphrase")
                    throw new DomainError(
                      "INVALID_REQUEST",
                      "Choose password or private key authentication",
                    );
                  return response;
                },
              }),
            );
          } finally {
            credential = undefined;
          }
        },
      );
      for (const [id, source] of this.sources)
        if (source.expiresAt <= Date.now()) this.sources.delete(id);
      const owned = [...this.sources.entries()].filter(
        ([, s]) => s.ownerId === principal.user.id,
      );
      if (owned.length >= 128) this.sources.delete(owned[0]![0]);
      if (this.sources.size >= 4096)
        this.sources.delete(this.sources.keys().next().value!);
      this.sources.set(session.id, {
        ownerId: principal.user.id,
        webSessionId: principal.webSessionId,
        expiresAt: principal.expiresAt,
        input: {
          protocol: "ssh",
          ...(profile ? { profileId: profile.id } : { settings }),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.workspaceEntryId
            ? { workspaceEntryId: input.workspaceEntryId }
            : {}),
        },
      });
      return session;
    } finally {
      lease.release();
    }
  }
}
