import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { HostTrustService } from "../apps/server/src/application/host-trust.js";
import { sshSettingsSchema } from "../packages/shared/src/index.js";
import type {
  TrustedKey,
  TrustRepository,
} from "../apps/server/src/domain/ports.js";
function fixture() {
  let saved: TrustedKey | null = null;
  const repository: TrustRepository = {
    find: vi.fn(async () => saved),
    save: vi.fn(async (key) => {
      saved = key;
      return true;
    }),
    verified: vi.fn(),
    list: vi.fn(async () => []),
    delete: vi.fn(),
  };
  const audit = { record: vi.fn() };
  return {
    service: new HostTrustService(repository, audit),
    repository,
    audit,
  };
}
function key(payload: string) {
  const type = Buffer.from("ssh-ed25519");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(type.length);
  return Buffer.concat([length, type, Buffer.from(payload)]);
}
const settings = sshSettingsSchema.parse({ host: "dut.lab", username: "lab" });
describe("host trust", () => {
  it("requires an explicit decision and never silently trusts", async () => {
    const f = fixture();
    const prompt = vi.fn(async () => ({ accept: false, save: false }));
    await expect(
      f.service.verify("owner", randomUUID(), settings, key("key"), prompt),
    ).rejects.toMatchObject({ code: "HOST_KEY_UNKNOWN" });
    expect(prompt).toHaveBeenCalledOnce();
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it("saves only accepted keys and blocks a changed key without prompting", async () => {
    const f = fixture();
    await f.service.verify(
      "owner",
      randomUUID(),
      settings,
      key("first"),
      async () => ({ accept: true, save: true }),
    );
    const prompt = vi.fn();
    await expect(
      f.service.verify("owner", randomUUID(), settings, key("changed"), prompt),
    ).rejects.toMatchObject({ code: "HOST_KEY_MISMATCH" });
    expect(prompt).not.toHaveBeenCalled();
    expect(f.repository.save).toHaveBeenCalledOnce();
  });
  it("strict unknown keys never offer TOFU", async () => {
    const f = fixture();
    const prompt = vi.fn();
    await expect(
      f.service.verify(
        "owner",
        randomUUID(),
        { ...settings, hostKeyPolicy: "strict" },
        key("key"),
        prompt,
      ),
    ).rejects.toMatchObject({ code: "HOST_KEY_UNKNOWN" });
    expect(prompt).not.toHaveBeenCalled();
  });
});
