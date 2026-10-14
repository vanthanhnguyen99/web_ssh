import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  authMaterialSchema,
  credentialDtoSchema,
  type AuthMaterial,
} from "@workspace/shared";
import type { CredentialStore } from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
import type { Database } from "./database.js";
import { credentials } from "./schema.js";
export class CredentialCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Credential key must be 32 bytes");
  }
  encrypt(ownerId: string, id: string, material: AuthMaterial) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`${ownerId}:${id}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(material)),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }
  decrypt(ownerId: string, id: string, value: string) {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(`${ownerId}:${id}`));
    decipher.setAuthTag(data.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]);
    try {
      return authMaterialSchema.parse(JSON.parse(plaintext.toString()));
    } finally {
      plaintext.fill(0);
    }
  }
}
export class PostgresCredentialStore implements CredentialStore {
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
  ) {}
  async list(ownerId: string) {
    const rows = await this.db
      .select({
        id: credentials.id,
        name: credentials.name,
        type: credentials.type,
      })
      .from(credentials)
      .where(eq(credentials.ownerId, ownerId));
    return rows.map((row) => credentialDtoSchema.parse(row));
  }
  async put(
    ownerId: string,
    name: string,
    material: AuthMaterial,
    id?: string,
  ) {
    const targetId = id ?? randomUUID();
    // Passphrases are session-only even when saving an encrypted key.
    material =
      material.type === "key"
        ? { type: "key", privateKey: material.privateKey }
        : material;
    const data = {
      name,
      type: material.type,
      ciphertext: this.cipher.encrypt(ownerId, targetId, material),
    };
    if (id) {
      const rows = await this.db
        .update(credentials)
        .set(data)
        .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)))
        .returning({ id: credentials.id });
      if (!rows.length)
        throw new DomainError("NOT_FOUND", "Credential not found", 404);
    } else
      await this.db
        .insert(credentials)
        .values({ id: targetId, ownerId, ...data });
    return credentialDtoSchema.parse({
      id: targetId,
      name,
      type: material.type,
    });
  }
  async get(ownerId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)));
    if (!row) throw new DomainError("NOT_FOUND", "Credential not found", 404);
    return this.cipher.decrypt(ownerId, id, row.ciphertext);
  }
  async delete(ownerId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(credentials)
        .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)));
    });
  }
}
