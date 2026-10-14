import { randomUUID } from "node:crypto";
import type {
  OutputFrame,
  ProtocolCapabilities,
  Replay,
  SessionDto,
  SessionState,
} from "@workspace/shared";
import type {
  AuthorizationService,
  Principal,
  ProtocolConnection,
  SessionRegistry,
} from "../domain/ports.js";
import { DomainError, publicError } from "../domain/errors.js";
export interface SessionSink {
  state(value: SessionDto): void;
  output(value: OutputFrame): void;
  prompt(event: string, value: Record<string, unknown>): void;
  replaced(id: string): void;
}
interface Pending {
  event: string;
  value: Record<string, unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}
interface ManagedSession {
  dto: SessionDto;
  ownerId: string;
  webSessionId: string;
  expiresAt: number;
  controller?: { id: string; sink: SessionSink };
  connection?: ProtocolConnection;
  abort: AbortController;
  frames: OutputFrame[];
  bytes: number;
  sequence: number;
  truncated: boolean;
  graceTimer?: ReturnType<typeof setTimeout>;
  expiryTimer: ReturnType<typeof setTimeout>;
  pending?: Pending;
  unlisten: (() => void)[];
  lastInputWindow: number;
  inputBytes: number;
}
export interface SessionContext {
  id: string;
  signal: AbortSignal;
  state(state: SessionState): void;
  prompt<T>(event: string, value: Record<string, unknown>): Promise<T>;
}
export class SessionManager implements SessionRegistry {
  private readonly reservations = new Map<
    string,
    Set<{ cancelled: boolean }>
  >();
  private reservationCount = 0;
  /** Track only in-flight creations so logout can cancel work that is awaiting DNS. */
  reserve(principal: Principal) {
    if (principal.expiresAt <= Date.now())
      throw new DomainError("SESSION_EXPIRED", "Web session expired", 401);
    if (this.reservationCount >= Math.max(128, this.options.maxSessions * 4))
      throw new DomainError(
        "SESSION_LIMIT_EXCEEDED",
        "Too many pending connection attempts",
        429,
      );
    const reservation = { cancelled: false };
    const entries =
      this.reservations.get(principal.webSessionId) ??
      new Set<{ cancelled: boolean }>();
    entries.add(reservation);
    this.reservations.set(principal.webSessionId, entries);
    this.reservationCount++;
    let released = false;
    return {
      assertActive: () => {
        if (reservation.cancelled || principal.expiresAt <= Date.now())
          throw new DomainError(
            "SESSION_EXPIRED",
            "Web session was revoked or expired",
            401,
          );
      },
      release: () => {
        if (released) return;
        released = true;
        entries.delete(reservation);
        this.reservationCount--;
        if (!entries.size) this.reservations.delete(principal.webSessionId);
      },
    };
  }
  private readonly attachmentListeners: ((
    id: string,
    principal: Principal,
  ) => void)[] = [];
  onAttachment(listener: (id: string, principal: Principal) => void) {
    this.attachmentListeners.push(listener);
  }
  private readonly revocationListeners: ((webSessionId?: string) => void)[] =
    [];
  onRevocation(listener: (webSessionId?: string) => void) {
    this.revocationListeners.push(listener);
  }
  private readonly lifecycleListeners: ((
    ownerId: string,
    session: SessionDto,
  ) => void)[] = [];
  onLifecycle(listener: (ownerId: string, session: SessionDto) => void) {
    this.lifecycleListeners.push(listener);
  }
  private failures = 0;
  private attachments = 0;
  metrics() {
    return {
      activeSessions: this.liveCount(),
      detachedSessions: [...this.sessions.values()].filter(
        (s) => s.dto.state === "DETACHED",
      ).length,
      connectionFailures: this.failures,
      attachments: this.attachments,
    };
  }
  private readonly sessions = new Map<string, ManagedSession>();
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly options: {
      maxSessions: number;
      graceMs: number;
      promptMs: number;
      replayBytes?: number;
    },
  ) {}
  create(
    principal: Principal,
    draft: {
      name: string;
      protocol: SessionDto["protocol"];
      host: string;
      port: number;
      username: string;
      capabilities: ProtocolCapabilities;
      profileId?: string;
      workspaceEntryId?: string;
      workspaceId?: string;
      terminal?: SessionDto["terminal"];
    },
    connect: (context: SessionContext) => Promise<ProtocolConnection>,
  ) {
    if (principal.expiresAt <= Date.now())
      throw new DomainError("SESSION_EXPIRED", "Web session expired", 401);
    if (this.liveCount() >= this.options.maxSessions)
      throw new DomainError(
        "SESSION_LIMIT_EXCEEDED",
        "Concurrent SSH session limit reached",
        429,
      );
    if (
      draft.workspaceId &&
      draft.workspaceEntryId &&
      [...this.sessions.values()].some(
        (session) =>
          session.ownerId === principal.user.id &&
          session.dto.workspaceId === draft.workspaceId &&
          session.dto.workspaceEntryId === draft.workspaceEntryId &&
          !["CLOSED", "FAILED"].includes(session.dto.state),
      )
    )
      throw new DomainError(
        "INVALID_REQUEST",
        "Workspace entry already has a live session",
      );
    const id = randomUUID();
    const dto: SessionDto = { id, ...draft, state: "CREATED" };
    const session: ManagedSession = {
      dto,
      ownerId: principal.user.id,
      webSessionId: principal.webSessionId,
      expiresAt: principal.expiresAt,
      abort: new AbortController(),
      frames: [],
      bytes: 0,
      sequence: 0,
      truncated: false,
      expiryTimer: setTimeout(
        () => this.closeInternal(id),
        Math.max(1, principal.expiresAt - Date.now()),
      ),
      unlisten: [],
      lastInputWindow: 0,
      inputBytes: 0,
    };
    session.expiryTimer.unref();
    this.sessions.set(id, session);
    this.scheduleGrace(session);
    // Return the allocated ID before starting handshake; prompts remain retained until attached.
    setTimeout(() => {
      if (session.abort.signal.aborted) return;
      this.setState(session, "CONNECTING");
      connect({
        id,
        signal: session.abort.signal,
        state: (state) => this.setState(session, state),
        prompt: (event, value) => this.request(session, event, value),
      })
        .then((connection) => {
          if (session.abort.signal.aborted) {
            connection.close();
            return;
          }
          session.connection = connection;
          if (connection.terminal)
            session.unlisten.push(
              connection.terminal.onData((data) => this.output(session, data)),
              connection.terminal.onClose(() => this.closeInternal(id)),
            );
          this.setState(session, session.controller ? "OPEN" : "DETACHED");
        })
        .catch((error) => {
          if (!session.abort.signal.aborted) {
            this.failures++;
            session.dto.error = publicError(error);
            this.setState(session, "FAILED");
            this.release(session);
          }
        });
    }, 0).unref();
    return this.snapshot(session);
  }
  private snapshot(session: ManagedSession) {
    return { ...session.dto };
  }
  private setState(session: ManagedSession, state: SessionState) {
    if (
      session.abort.signal.aborted &&
      state !== "CLOSING" &&
      state !== "CLOSED"
    )
      return;
    session.dto.state = state;
    if (["OPEN", "DETACHED", "CLOSED", "FAILED"].includes(state))
      for (const listener of this.lifecycleListeners)
        listener(session.ownerId, this.snapshot(session));
    session.controller?.sink.state(this.snapshot(session));
  }
  private request<T>(
    session: ManagedSession,
    event: string,
    value: Record<string, unknown>,
  ): Promise<T> {
    if (session.abort.signal.aborted)
      return Promise.reject(
        new DomainError("SESSION_EXPIRED", "Session closed"),
      );
    if (session.pending)
      return Promise.reject(
        new DomainError(
          "INVALID_REQUEST",
          "A session prompt is already pending",
        ),
      );
    return new Promise<T>((resolve, reject) => {
      const request = {
        ...value,
        sessionId: session.dto.id,
        requestId: value.requestId ?? randomUUID(),
      };
      const timer = setTimeout(() => {
        session.pending = undefined;
        reject(
          new DomainError(
            event === "hostkey:request" ? "HOST_KEY_UNKNOWN" : "AUTH_FAILED",
            "Session prompt expired",
          ),
        );
      }, this.options.promptMs);
      timer.unref();
      session.pending = {
        event,
        value: request,
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      };
      session.controller?.sink.prompt(event, request);
    });
  }
  private owned(principal: Principal, id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new DomainError("NOT_FOUND", "Session not found", 404);
    this.authorization.owned(session.ownerId, principal.user.id);
    if (principal.expiresAt <= Date.now())
      throw new DomainError("SESSION_EXPIRED", "Web session expired", 401);
    return session;
  }
  private controlled(principal: Principal, id: string, controllerId: string) {
    const session = this.owned(principal, id);
    if (session.controller?.id !== controllerId)
      throw new DomainError(
        "FORBIDDEN",
        "This browser does not control the session",
        403,
      );
    return session;
  }
  list(ownerId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.ownerId === ownerId)
      .map((s) => this.snapshot(s));
  }
  attach(
    principal: Principal,
    id: string,
    controllerId: string,
    sink: SessionSink,
    afterSequence?: number,
  ): Replay {
    const session = this.owned(principal, id);
    this.attachments++;
    if (session.dto.state === "CLOSED" || session.dto.state === "FAILED") {
      sink.state(this.snapshot(session));
      return {
        sessionId: id,
        reset: true,
        truncated: session.truncated,
        frames: session.frames,
      };
    }
    if (session.controller && session.controller.id !== controllerId)
      session.controller.sink.replaced(id);
    for (const listener of this.attachmentListeners) listener(id, principal);
    session.webSessionId = principal.webSessionId;
    session.expiresAt = principal.expiresAt;
    clearTimeout(session.expiryTimer);
    session.expiryTimer = setTimeout(
      () => this.closeInternal(id),
      Math.max(1, principal.expiresAt - Date.now()),
    );
    session.expiryTimer.unref();
    session.controller = { id: controllerId, sink };
    clearTimeout(session.graceTimer);
    session.graceTimer = undefined;
    if (session.connection) this.setState(session, "OPEN");
    else sink.state(this.snapshot(session));
    if (session.pending)
      sink.prompt(session.pending.event, session.pending.value);
    const oldest = session.frames[0]?.sequence ?? session.sequence + 1;
    const reset =
      afterSequence === undefined ||
      afterSequence < oldest - 1 ||
      afterSequence > session.sequence;
    return {
      sessionId: id,
      reset,
      truncated: reset && session.truncated,
      frames: session.frames.filter(
        (frame) => reset || frame.sequence > afterSequence!,
      ),
    };
  }
  detach(principal: Principal, id: string, controllerId: string) {
    const session = this.controlled(principal, id, controllerId);
    this.detachInternal(session);
  }
  detachController(controllerId: string) {
    for (const session of this.sessions.values())
      if (session.controller?.id === controllerId) this.detachInternal(session);
  }
  private detachInternal(session: ManagedSession) {
    session.controller = undefined;
    if (session.connection && session.dto.state === "OPEN")
      this.setState(session, "DETACHED");
    if (session.dto.state !== "CLOSED" && session.dto.state !== "FAILED")
      this.scheduleGrace(session);
  }
  private scheduleGrace(session: ManagedSession) {
    clearTimeout(session.graceTimer);
    session.graceTimer = setTimeout(
      () => this.closeInternal(session.dto.id),
      this.options.graceMs,
    );
    session.graceTimer.unref();
  }
  respond(
    principal: Principal,
    id: string,
    controllerId: string,
    requestId: string,
    event: string,
    value: unknown,
  ) {
    const session = this.controlled(principal, id, controllerId);
    const pending = session.pending;
    if (
      !pending ||
      pending.event !== event ||
      pending.value.requestId !== requestId
    )
      throw new DomainError(
        "INVALID_REQUEST",
        "Prompt is stale or does not belong to this session",
      );
    clearTimeout(pending.timer);
    session.pending = undefined;
    pending.resolve(value);
  }
  input(principal: Principal, id: string, controllerId: string, data: string) {
    const session = this.controlled(principal, id, controllerId);
    if (session.dto.state !== "OPEN" || !session.connection?.terminal)
      throw new DomainError("SESSION_EXPIRED", "Terminal is not open");
    const now = Date.now();
    if (now - session.lastInputWindow > 1000) {
      session.lastInputWindow = now;
      session.inputBytes = 0;
    }
    session.inputBytes += Buffer.byteLength(data);
    if (session.inputBytes > 262144)
      throw new DomainError(
        "RATE_LIMITED",
        "Terminal input rate exceeded",
        429,
      );
    if (!session.connection.terminal.write(data)) {
      this.closeInternal(id);
      throw new DomainError(
        "SLOW_CONSUMER",
        "Remote terminal cannot consume input",
      );
    }
  }
  resize(
    principal: Principal,
    id: string,
    controllerId: string,
    columns: number,
    rows: number,
  ) {
    const session = this.controlled(principal, id, controllerId);
    session.connection?.terminal?.resize(columns, rows);
  }
  promoteProfile(
    principal: Principal,
    id: string,
    profileId: string,
    name: string,
  ) {
    const session = this.owned(principal, id);
    if (["CLOSED", "FAILED", "CLOSING"].includes(session.dto.state))
      throw new DomainError("SESSION_EXPIRED", "Session is closed");
    session.dto.profileId = profileId;
    session.dto.name = name;
    session.controller?.sink.state(this.snapshot(session));
    return this.snapshot(session);
  }
  associateWorkspace(
    principal: Principal,
    id: string,
    workspaceId: string,
    workspaceEntryId: string,
  ) {
    const session = this.owned(principal, id);
    if (session.dto.state === "CLOSED" || session.dto.state === "FAILED")
      throw new DomainError("SESSION_EXPIRED", "Session is closed");
    // Only one live session may own a particular saved entry.
    for (const existing of this.sessions.values())
      if (
        existing.ownerId === principal.user.id &&
        existing.dto.id !== id &&
        existing.dto.workspaceId === workspaceId &&
        existing.dto.workspaceEntryId === workspaceEntryId
      ) {
        delete existing.dto.workspaceId;
        delete existing.dto.workspaceEntryId;
      }
    session.dto.workspaceId = workspaceId;
    session.dto.workspaceEntryId = workspaceEntryId;
    session.controller?.sink.state(this.snapshot(session));
    return this.snapshot(session);
  }
  close(principal: Principal, id: string) {
    this.owned(principal, id);
    this.closeInternal(id);
  }
  private output(session: ManagedSession, data: Uint8Array) {
    if (session.abort.signal.aborted) return;
    for (let offset = 0; offset < data.byteLength; offset += 16384) {
      const frame = {
        sessionId: session.dto.id,
        sequence: ++session.sequence,
        data: Buffer.from(data.subarray(offset, offset + 16384)),
      };
      session.frames.push(frame);
      session.bytes += frame.data.byteLength;
      while (
        (session.bytes > (this.options.replayBytes ?? 1048576) ||
          session.frames.length > 4096) &&
        session.frames.length
      ) {
        session.bytes -= session.frames.shift()!.data.byteLength;
        session.truncated = true;
      }
      session.controller?.sink.output(frame);
    }
  }
  private release(session: ManagedSession) {
    session.abort.abort();
    clearTimeout(session.graceTimer);
    clearTimeout(session.expiryTimer);
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(
        new DomainError("SESSION_EXPIRED", "Session closed"),
      );
      session.pending = undefined;
    }
    for (const unsubscribe of session.unlisten) unsubscribe();
    session.unlisten = [];
    session.connection?.close();
    session.connection = undefined;
    session.controller = undefined; // Retain only lightweight terminal status for the owning client.
    session.frames = [];
    session.bytes = 0;
    const cleanup = setTimeout(
      () => this.sessions.delete(session.dto.id),
      60000,
    );
    cleanup.unref();
  }
  private closeInternal(id: string) {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.dto.state === "CLOSED" ||
      session.dto.state === "FAILED"
    )
      return;
    this.setState(session, "CLOSING");
    this.setState(session, "CLOSED");
    this.release(session);
  }
  closeByWebSession(webSessionId: string) {
    for (const pending of this.reservations.get(webSessionId) ?? [])
      pending.cancelled = true;
    for (const listener of this.revocationListeners) listener(webSessionId);
    for (const session of this.sessions.values())
      if (session.webSessionId === webSessionId)
        this.closeInternal(session.dto.id);
  }
  liveCount() {
    return [...this.sessions.values()].filter(
      (s) => s.dto.state !== "CLOSED" && s.dto.state !== "FAILED",
    ).length;
  }
  shutdown() {
    for (const entries of this.reservations.values())
      for (const pending of entries) pending.cancelled = true;
    for (const listener of this.revocationListeners) listener();
    for (const session of this.sessions.values())
      this.closeInternal(session.dto.id);
    this.sessions.clear();
  }
}
