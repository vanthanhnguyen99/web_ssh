import { describe, it, expect } from "vitest";
import {
  parseQuickConnect,
  preferencesSchema,
  authResponseSchema,
  credentialInputSchema,
} from "../packages/shared/src/index.js";
import { randomUUID } from "node:crypto";
describe("Phase 1 contracts", () => {
  it("parses documented SSH syntax and bracketed IPv6 without shell interpretation", () => {
    expect(parseQuickConnect("ssh admin@dut.lab")).toMatchObject({
      username: "admin",
      host: "dut.lab",
      port: 22,
    });
    expect(parseQuickConnect("admin@192.168.1.1:2222")).toMatchObject({
      host: "192.168.1.1",
      port: 2222,
    });
    expect(parseQuickConnect("lab@[2001:db8::1]:2222")).toMatchObject({
      host: "2001:db8::1",
      port: 2222,
    });
    expect(parseQuickConnect("[::1]", { username: "lab" })).toMatchObject({
      host: "::1",
      username: "lab",
    });
    for (const text of [
      "ssh -p 22 lab@dut",
      "lab@dut;whoami",
      "lab@dut $(whoami)",
      "lab@::1",
      "lab@dut:65536",
      "dut",
    ]) {
      expect(() => parseQuickConnect(text)).toThrow();
    }
  });
  it("validates appearance independently of chrome and bounds terminal resources", () => {
    expect(
      preferencesSchema.parse({
        theme: "classic-light",
        appearance: { palette: "solarized-dark" },
      }),
    ).toMatchObject({
      theme: "classic-light",
      appearance: { palette: "solarized-dark" },
      terminal: { scrollback: 5000 },
    });
    expect(
      preferencesSchema.safeParse({ terminal: { scrollback: 100000 } }).success,
    ).toBe(false);
    expect(
      preferencesSchema.safeParse({ appearance: { fontSize: 100 } }).success,
    ).toBe(false);
  });
  it("accepts passphrase-only challenge replies but never as persistent credentials", () => {
    const material = { type: "passphrase", passphrase: "transient" };
    expect(
      authResponseSchema.parse({
        sessionId: randomUUID(),
        requestId: randomUUID(),
        credential: material,
      }).credential,
    ).toEqual(material);
    expect(
      credentialInputSchema.safeParse({ name: "secret", material }).success,
    ).toBe(false);
  });
});

import { vi } from "vitest";
import { SessionManager } from "../apps/server/src/application/session-manager.js";
import { SshSessionService } from "../apps/server/src/application/sessions.js";
import { HostTrustService } from "../apps/server/src/application/host-trust.js";
import { OwnershipAuthorization } from "../apps/server/src/domain/authorization.js";
import type {
  CatalogRepository,
  CredentialStore,
  Principal,
  ProtocolAdapter,
  SshConnectContext,
  Target,
} from "../apps/server/src/domain/ports.js";
import { sshCapabilities } from "../packages/shared/src/index.js";
it("cancels a connection creation awaiting target resolution when its web session logs out", async () => {
  const principal: Principal = {
    user: { id: randomUUID(), username: "owner", role: "admin" },
    webSessionId: randomUUID(),
    csrfToken: "csrf",
    expiresAt: Date.now() + 60000,
  };
  const manager = new SessionManager(new OwnershipAuthorization(), {
    maxSessions: 2,
    graceMs: 1000,
    promptMs: 1000,
  });
  const catalog: CatalogRepository = {
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    putProfile: vi.fn(),
    deleteProfile: vi.fn(),
    listFolders: vi.fn(),
    putFolder: vi.fn(),
    deleteFolder: vi.fn(),
    listWorkspaces: vi.fn(),
    putWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    getPreferences: vi.fn(),
    putPreferences: vi.fn(),
  };
  const credentials: CredentialStore = {
    list: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };
  const adapter: ProtocolAdapter<SshConnectContext> = {
    protocol: "ssh",
    capabilities: sshCapabilities,
    connect: vi.fn(),
  };
  let resolve!: (target: Target) => void;
  const pending = new Promise<Target>((r) => (resolve = r));
  const trust = new HostTrustService(
    {
      find: vi.fn(),
      save: vi.fn(),
      verified: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
    { record: vi.fn() },
  );
  const service = new SshSessionService(
    manager,
    new Map([["ssh", adapter]]),
    { resolve: () => pending },
    catalog,
    credentials,
    trust,
  );
  const creation = service.create(principal, {
    protocol: "ssh",
    settings: parseQuickConnect("lab@dut.lab"),
    credential: { type: "password", password: "never-dial" },
  });
  manager.closeByWebSession(principal.webSessionId);
  resolve({ host: "dut.lab", address: "192.168.1.1", port: 22 });
  await expect(creation).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(manager.liveCount()).toBe(0);
  expect(adapter.connect).not.toHaveBeenCalled();
  manager.shutdown();
});
