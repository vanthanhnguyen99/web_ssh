import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import {
  modernAuthenticationKey,
  modernSshAlgorithms,
} from "../apps/server/src/infrastructure/ssh-algorithms.js";

const ssh2 = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
)("ssh2") as {
  utils: {
    parseKey(value: string): ReturnType<typeof modernAuthenticationKey> | Error;
  };
};

describe("explicit SSH algorithm policy", () => {
  it("replaces every transport default and excludes legacy hashes/ciphers/signatures", () => {
    const algorithms = modernSshAlgorithms();
    expect(Object.keys(algorithms).sort()).toEqual([
      "cipher",
      "compress",
      "hmac",
      "kex",
      "serverHostKey",
    ]);
    const all = Object.values(algorithms).flat() as string[];
    expect(
      all.some((name) => /sha1|md5|cbc|arcfour|ssh-rsa|ssh-dss/.test(name)),
    ).toBe(false);
    expect(algorithms.serverHostKey).toEqual(
      expect.arrayContaining(["rsa-sha2-256", "rsa-sha2-512", "ssh-ed25519"]),
    );
    expect(algorithms.kex).toContain("curve25519-sha256");
    expect(algorithms.hmac).toContain("hmac-sha2-512-etm@openssh.com");
    expect(algorithms.cipher).toContain("aes256-gcm@openssh.com");
  });
  it("never signs RSA with upstream SHA1 or implicit fallback, while SHA2 signatures verify", () => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const parsed = ssh2.utils.parseKey(pair.privateKey);
    if (parsed instanceof Error) throw parsed;
    const original = vi.spyOn(parsed, "sign");
    const key = modernAuthenticationKey(parsed);
    const message = Buffer.from("RSA signature policy regression");
    expect(key.sign(message, "sha1")).toBeInstanceOf(Error);
    expect(key.sign(message)).toBeInstanceOf(Error);
    expect(original).not.toHaveBeenCalled();
    for (const algorithm of ["sha256", "sha512"]) {
      const signature = key.sign(message, algorithm);
      expect(Buffer.isBuffer(signature)).toBe(true);
      expect(key.verify(message, signature, algorithm)).toBe(true);
    }
    expect(original).toHaveBeenCalledTimes(2);
    expect(key.type).toBe("ssh-rsa");
  });
  it("rejects DSA user authentication before any signing", () => {
    const sign = vi.fn();
    const key = { type: "ssh-dss", sign } as unknown as ReturnType<
      typeof modernAuthenticationKey
    >;
    expect(() => modernAuthenticationKey(key)).toThrow(
      "DSA authentication is disabled",
    );
    expect(sign).not.toHaveBeenCalled();
  });
});
