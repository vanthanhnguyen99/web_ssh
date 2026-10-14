import type { Algorithms, ParsedKey } from "ssh2";
import { DomainError } from "../domain/errors.js";

/** Explicit allowlists: upstream library defaults must never silently enable legacy algorithms. */
export function modernSshAlgorithms(): Algorithms {
  return {
    kex: [
      "curve25519-sha256",
      "curve25519-sha256@libssh.org",
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
      "diffie-hellman-group14-sha256",
      "diffie-hellman-group16-sha512",
      "diffie-hellman-group18-sha512",
    ],
    serverHostKey: [
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "rsa-sha2-512",
      "rsa-sha2-256",
    ],
    cipher: [
      "aes256-gcm@openssh.com",
      "aes128-gcm@openssh.com",
      "chacha20-poly1305@openssh.com",
      "aes256-ctr",
      "aes192-ctr",
      "aes128-ctr",
    ],
    hmac: [
      "hmac-sha2-512-etm@openssh.com",
      "hmac-sha2-256-etm@openssh.com",
      "hmac-sha2-512",
      "hmac-sha2-256",
    ],
    compress: ["none"],
  };
}

/** The public ssh2 auth API has no signature-policy option; constrain its per-key signing hook. */
export function modernAuthenticationKey(key: ParsedKey): ParsedKey {
  if (key.type === "ssh-dss")
    throw new DomainError(
      "AUTH_METHOD_UNSUPPORTED",
      "DSA authentication is disabled",
    );
  if (key.type !== "ssh-rsa") return key;
  const sign = key.sign.bind(key);
  key.sign = (data, algorithm) => {
    if (algorithm !== "sha256" && algorithm !== "sha512") {
      // ssh2's runtime contract accepts Error results and fails authentication safely.
      // Its published ParsedKey TypeScript signature omits that supported result.
      return new DomainError(
        "AUTH_METHOD_UNSUPPORTED",
        "RSA authentication requires SHA-256 or SHA-512 signatures",
      ) as unknown as Buffer;
    }
    return sign(data, algorithm);
  };
  return key;
}
