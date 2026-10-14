import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import type { Target, TargetPolicy } from "../domain/ports.js";
import { DomainError } from "../domain/errors.js";
type Range = [ipaddr.IPv4 | ipaddr.IPv6, number];
export interface PolicyConfig {
  allowedCidrs: string[];
  deniedCidrs: string[];
  allowedPorts: number[];
  dnsSuffixes: string[];
}
export class NetworkTargetPolicy implements TargetPolicy {
  private readonly allowed: Range[];
  private readonly denied: Range[];
  constructor(
    private readonly config: PolicyConfig,
    private readonly resolveDns: (
      host: string,
    ) => Promise<{ address: string }[]> = (host) =>
      lookup(host, { all: true, verbatim: true }),
  ) {
    this.allowed = config.allowedCidrs.map((c) => ipaddr.parseCIDR(c));
    this.denied = config.deniedCidrs.map((c) => ipaddr.parseCIDR(c));
  }
  private permitted(address: string) {
    const ip = ipaddr.process(address);
    const contains = ([range, prefix]: Range) => {
      const normalized =
        range.kind() === "ipv6" && (range as ipaddr.IPv6).isIPv4MappedAddress()
          ? (range as ipaddr.IPv6).toIPv4Address()
          : range;
      const bits = normalized !== range ? prefix - 96 : prefix;
      return (
        bits >= 0 &&
        ip.kind() === normalized.kind() &&
        ip.match(normalized, bits)
      );
    };
    return !this.denied.some(contains) && this.allowed.some(contains);
  }
  async resolve(host: string, port: number): Promise<Target> {
    if (!this.config.allowedPorts.includes(port) || host.includes("%"))
      throw new DomainError(
        "TARGET_NOT_ALLOWED",
        "Target port or address is not permitted",
        403,
      );
    let addresses: { address: string }[];
    if (ipaddr.isValid(host)) addresses = [{ address: host }];
    else {
      const normalized = host.toLowerCase().replace(/\.$/, "");
      if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized))
        throw new DomainError("TARGET_NOT_ALLOWED", "Invalid hostname", 403);
      if (
        this.config.dnsSuffixes.length &&
        !this.config.dnsSuffixes.some(
          (s) =>
            normalized === s.toLowerCase().replace(/^\./, "") ||
            normalized.endsWith("." + s.toLowerCase().replace(/^\./, "")),
        )
      )
        throw new DomainError(
          "TARGET_NOT_ALLOWED",
          "Hostname is outside DNS policy",
          403,
        );
      try {
        addresses = await this.resolveDns(normalized);
      } catch {
        throw new DomainError(
          "DNS_RESOLUTION_FAILED",
          "Target hostname could not be resolved",
        );
      }
    }
    if (!addresses.length)
      throw new DomainError(
        "DNS_RESOLUTION_FAILED",
        "No target addresses were resolved",
      );
    if (
      addresses.some(
        (a) => !ipaddr.isValid(a.address) || !this.permitted(a.address),
      )
    )
      throw new DomainError(
        "TARGET_NOT_ALLOWED",
        "Target address is outside the configured network policy",
        403,
      );
    return {
      host,
      address: ipaddr.process(addresses[0]!.address).toString(),
      port,
    };
  }
}
