import { createHash, randomUUID } from "node:crypto";
import type {
  HostKeyRequest,
  SshSettings,
  TrustImport,
} from "@workspace/shared";
import type { AuditRepository, TrustRepository } from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
export class HostTrustService {
  private mismatches = 0;
  metrics() {
    return { hostKeyMismatches: this.mismatches };
  }
  constructor(
    private readonly repository: TrustRepository,
    private readonly audit: AuditRepository,
  ) {}
  async verify(
    ownerId: string,
    sessionId: string,
    settings: SshSettings,
    key: Uint8Array,
    decide: (
      request: HostKeyRequest,
    ) => Promise<{ accept: boolean; save: boolean }>,
  ) {
    const bytes = Buffer.from(key);
    const length = bytes.readUInt32BE(0);
    const algorithm = bytes.subarray(4, 4 + length).toString();
    const fingerprint =
      "SHA256:" +
      createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
    const host = settings.host.toLowerCase().replace(/\.$/, "");
    const known = await this.repository.find(ownerId, host, settings.port);
    if (known) {
      if (
        known.fingerprint !== fingerprint ||
        known.publicKey !== bytes.toString("base64")
      ) {
        this.mismatches++;
        await this.audit.record(
          ownerId,
          "hostkey.mismatch",
          `${host}:${settings.port}`,
          { expected: known.fingerprint, received: fingerprint },
        );
        throw new DomainError(
          "HOST_KEY_MISMATCH",
          "SSH host key changed; connection blocked",
          403,
          { expected: known.fingerprint, received: fingerprint },
        );
      }
      await this.repository.verified(known.id);
      return true;
    }
    if (settings.hostKeyPolicy === "strict")
      throw new DomainError(
        "HOST_KEY_UNKNOWN",
        "Strict verification requires a trusted host key",
        403,
      );
    const decision = await decide({
      sessionId,
      requestId: randomUUID(),
      host: settings.host,
      port: settings.port,
      algorithm,
      fingerprint,
    });
    if (!decision.accept)
      throw new DomainError("HOST_KEY_UNKNOWN", "Host key was rejected", 403);
    if (decision.save) {
      const now = new Date().toISOString();
      const inserted = await this.repository.save({
        id: randomUUID(),
        ownerId,
        host,
        port: settings.port,
        algorithm,
        fingerprint,
        publicKey: bytes.toString("base64"),
        firstSeenAt: now,
        lastVerifiedAt: now,
      });
      if (!inserted) {
        const concurrent = await this.repository.find(
          ownerId,
          host,
          settings.port,
        );
        if (
          !concurrent ||
          concurrent.fingerprint !== fingerprint ||
          concurrent.publicKey !== bytes.toString("base64")
        )
          throw new DomainError(
            "HOST_KEY_MISMATCH",
            "Trusted key changed during verification",
            403,
          );
      }
      await this.audit.record(
        ownerId,
        "hostkey.accept",
        `${host}:${settings.port}`,
        { fingerprint },
      );
    }
    return true;
  }
  async import(ownerId: string, input: TrustImport) {
    const match =
      /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/]+={0,2})(?: .*)?$/.exec(
        input.publicKey,
      );
    if (!match)
      throw new DomainError(
        "INVALID_REQUEST",
        "Use an OpenSSH public key line",
      );
    const bytes = Buffer.from(match[2]!, "base64");
    if (
      bytes.length < 8 ||
      bytes.readUInt32BE(0) > 128 ||
      bytes.subarray(4, 4 + bytes.readUInt32BE(0)).toString() !== match[1]
    )
      throw new DomainError("INVALID_REQUEST", "Invalid public key encoding");
    // Check complete wire framing. The SSH verifier itself compares the entire key blob.
    let offset = 0;
    const fields: Buffer[] = [];
    while (offset < bytes.length) {
      if (offset + 4 > bytes.length)
        throw new DomainError("INVALID_REQUEST", "Invalid public key");
      const size = bytes.readUInt32BE(offset);
      offset += 4;
      if (size === 0 || offset + size > bytes.length)
        throw new DomainError("INVALID_REQUEST", "Invalid public key");
      fields.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    if (
      (match[1] === "ssh-ed25519" &&
        (fields.length !== 2 || fields[1]!.length !== 32)) ||
      (match[1] === "ssh-rsa" && fields.length !== 3) ||
      (match[1]!.startsWith("ecdsa-") && fields.length !== 3)
    )
      throw new DomainError("INVALID_REQUEST", "Invalid public key fields");
    const fingerprint =
      "SHA256:" +
      createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
    const host = input.host.toLowerCase().replace(/\.$/, "");
    const now = new Date().toISOString();
    const key = {
      id: randomUUID(),
      ownerId,
      host,
      port: input.port,
      algorithm: match[1]!,
      fingerprint,
      publicKey: bytes.toString("base64"),
      firstSeenAt: now,
      lastVerifiedAt: now,
    };
    if (!(await this.repository.save(key)))
      throw new DomainError(
        "HOST_KEY_MISMATCH",
        "A trusted key already exists; remove it explicitly before import",
        409,
      );
    await this.audit.record(
      ownerId,
      "hostkey.import",
      `${host}:${input.port}`,
      { fingerprint },
    );
    return {
      id: key.id,
      host,
      port: key.port,
      algorithm: key.algorithm,
      fingerprint,
      firstSeenAt: now,
      lastVerifiedAt: now,
    };
  }
  list(ownerId: string) {
    return this.repository.list(ownerId);
  }
  async remove(ownerId: string, id: string) {
    await this.repository.delete(ownerId, id);
    await this.audit.record(ownerId, "hostkey.remove", id);
  }
}
