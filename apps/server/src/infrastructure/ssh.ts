import ssh2, { type ClientChannel, type ConnectConfig } from "ssh2";
const { Client, utils } = ssh2;
import { sshCapabilities } from "@workspace/shared";
import type {
  ProtocolAdapter,
  SshConnectContext,
  TerminalChannel,
} from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
import {
  modernSshAlgorithms,
  modernAuthenticationKey,
} from "./ssh-algorithms.js";
class SshTerminal implements TerminalChannel {
  constructor(private readonly channel: ClientChannel) {}
  write(data: string) {
    if (this.channel.writableLength + Buffer.byteLength(data) > 262144)
      return false;
    this.channel.write(data);
    return true;
  }
  resize(columns: number, rows: number) {
    this.channel.setWindow(rows, columns, 0, 0);
  }
  close() {
    this.channel.close();
  }
  onData(callback: (data: Uint8Array) => void) {
    const listener = (data: Buffer) => callback(data);
    this.channel.on("data", listener);
    this.channel.stderr.on("data", listener);
    return () => {
      this.channel.off("data", listener);
      this.channel.stderr.off("data", listener);
    };
  }
  onClose(callback: () => void) {
    this.channel.on("close", callback);
    return () => {
      this.channel.off("close", callback);
    };
  }
}
export class SshProtocolAdapter implements ProtocolAdapter<SshConnectContext> {
  readonly protocol = "ssh";
  readonly capabilities = sshCapabilities;
  constructor(private readonly timeoutMs: number) {}
  connect(context: SshConnectContext) {
    return new Promise<import("../domain/ports.js").ProtocolConnection>(
      (resolve, reject) => {
        const client = new Client();
        let settled = false;
        let verificationError: unknown;
        let authenticated = false;
        const abort = () => {
          client.destroy();
          finishError(
            new DomainError("SESSION_EXPIRED", "Connection cancelled"),
          );
        };
        const finishError = (error: unknown) => {
          if (settled) return;
          settled = true;
          context.signal.removeEventListener("abort", abort);
          client.destroy();
          reject(error);
        };
        client.on("error", (error) => {
          if (settled) return;
          const e = error as Error & { level?: string; code?: string };
          const code =
            e.level === "client-authentication"
              ? "AUTH_FAILED"
              : e.code === "ECONNREFUSED"
                ? "TCP_CONNECTION_REFUSED"
                : e.code === "ETIMEDOUT" || e.message.includes("Timed out")
                  ? "TCP_TIMEOUT"
                  : "SSH_HANDSHAKE_FAILED";
          finishError(
            verificationError ??
              new DomainError(
                code,
                code === "AUTH_FAILED"
                  ? "SSH authentication failed"
                  : "SSH connection failed",
              ),
          );
        });
        client.on("close", () => {
          if (!settled)
            finishError(
              verificationError ??
                new DomainError(
                  "SSH_HANDSHAKE_FAILED",
                  "SSH connection closed before shell opened",
                ),
            );
        });
        client.on("ready", () => {
          client.shell(
            {
              term: context.settings.terminal.type,
              cols: context.settings.terminal.columns,
              rows: context.settings.terminal.rows,
            },
            (error, channel) => {
              if (error) {
                finishError(
                  new DomainError(
                    "PTY_ALLOCATION_FAILED",
                    "Unable to open an SSH terminal",
                  ),
                );
                return;
              }
              if (settled || context.signal.aborted) {
                channel.close();
                return;
              }
              settled = true;
              resolve({
                capabilities: this.capabilities,
                terminal: new SshTerminal(channel),
                close: () => {
                  context.signal.removeEventListener("abort", abort);
                  channel.close();
                  client.end();
                  setTimeout(() => client.destroy(), 500).unref();
                },
              });
            },
          );
        });
        context.signal.addEventListener("abort", abort, { once: true });
        if (context.signal.aborted) {
          abort();
          return;
        }
        const config: ConnectConfig = {
          host: context.target.address,
          port: context.target.port,
          username: context.settings.username,
          readyTimeout: this.timeoutMs,
          algorithms: modernSshAlgorithms(),
          keepaliveInterval: context.settings.terminal.keepaliveSeconds * 1000,
          keepaliveCountMax: 3,
          hostVerifier: (
            key: Buffer,
            callback: (accepted: boolean) => void,
          ) => {
            context
              .verifyHostKey(key)
              .then((result) => {
                if (!settled && !context.signal.aborted) callback(result);
              })
              .catch((error) => {
                verificationError = error;
                if (!settled && !context.signal.aborted) callback(false);
              });
          },
          authHandler: (_methods, _partial, callback) => {
            if (authenticated) {
              finishError(
                new DomainError("AUTH_FAILED", "SSH authentication failed"),
              );
              return;
            }
            authenticated = true;
            context.authenticating();
            context
              .authenticate()
              .then(async (material) => {
                if (context.signal.aborted) return;
                if (material.type === "password")
                  callback({
                    type: "password",
                    username: context.settings.username,
                    password: material.password,
                  });
                else {
                  let key = utils.parseKey(
                    material.privateKey,
                    material.passphrase,
                  );
                  if (
                    key instanceof Error &&
                    !material.passphrase &&
                    /encrypted|passphrase/i.test(key.message)
                  ) {
                    const passphrase = await context.requestPassphrase();
                    key = utils.parseKey(material.privateKey, passphrase);
                  }
                  if (key instanceof Error || Array.isArray(key))
                    throw new DomainError(
                      "AUTH_FAILED",
                      "Private key or passphrase could not be used",
                    );
                  if (context.signal.aborted) return;
                  callback({
                    type: "publickey",
                    username: context.settings.username,
                    key: modernAuthenticationKey(key),
                  });
                }
              })
              .catch((error) => {
                verificationError = error;
                finishError(error);
              });
          },
        };
        try {
          client.connect(config);
        } catch {
          finishError(
            new DomainError(
              "AUTH_FAILED",
              "SSH authentication material could not be used",
            ),
          );
        }
      },
    );
  }
}
