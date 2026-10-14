import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AuthRepository,
  IdentityProvider,
  Principal,
  SessionRegistry,
} from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
export class WindowRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  take(key: string) {
    const now = Date.now();
    let entry = this.buckets.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + this.windowMs };
      this.buckets.set(key, entry);
    }
    if (++entry.count > this.limit)
      throw new DomainError(
        "RATE_LIMITED",
        "Too many attempts; try again later",
        429,
      );
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets)
        if (v.until <= now) this.buckets.delete(k);
      if (this.buckets.size > 10000)
        this.buckets.delete(this.buckets.keys().next().value!);
    }
  }
}
export class AuthService {
  private readonly loginLimiter = new WindowRateLimiter(10, 60000);
  constructor(
    private readonly identity: IdentityProvider,
    private readonly repository: AuthRepository,
    private readonly sessions: SessionRegistry,
    private readonly lifetimeMs: number,
  ) {}
  async login(username: string, password: string, source: string) {
    this.loginLimiter.take(source);
    const user = await this.identity.authenticate(username, password);
    if (!user)
      throw new DomainError(
        "UNAUTHORIZED",
        "Invalid username or password",
        401,
      );
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    await this.repository.createSession(
      this.hash(token),
      user.id,
      csrfToken,
      new Date(Date.now() + this.lifetimeMs),
    );
    return { token, csrfToken, user };
  }
  private hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async authenticate(token?: string): Promise<Principal> {
    if (!token || token.length > 128)
      throw new DomainError("UNAUTHORIZED", "Login required", 401);
    const principal = await this.repository.getSession(this.hash(token));
    if (!principal)
      throw new DomainError("UNAUTHORIZED", "Login required", 401);
    if (principal.expiresAt <= Date.now()) {
      await this.logout(principal);
      throw new DomainError("SESSION_EXPIRED", "Web session expired", 401);
    }
    return principal;
  }
  csrf(principal: Principal, value?: string) {
    const a = Buffer.from(principal.csrfToken);
    const b = Buffer.from(value ?? "");
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new DomainError("FORBIDDEN", "Invalid CSRF token", 403);
  }
  async logout(principal: Principal) {
    this.sessions.closeByWebSession(principal.webSessionId);
    await this.repository.deleteSession(principal.webSessionId);
  }
  async sweep() {
    for (const id of await this.repository.expiredSessionIds()) {
      this.sessions.closeByWebSession(id);
      await this.repository.deleteSession(id);
    }
  }
}
