import { describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { NetworkTargetPolicy } from '../apps/server/src/infrastructure/target-policy.js';
import { CredentialCipher } from '../apps/server/src/infrastructure/credentials.js';

describe('independent review: network target isolation', () => {
  const policyConfig = {
    allowedCidrs: ['10.42.0.0/16', '2001:db8:42::/48'],
    deniedCidrs: ['10.42.255.0/24', '127.0.0.0/8', '169.254.0.0/16', '::1/128'],
    allowedPorts: [22, 2222],
    dnsSuffixes: ['lab.example'],
  };

  it('denies targets until networks are explicitly permitted', async () => {
    const policy = new NetworkTargetPolicy({ ...policyConfig, allowedCidrs: [] });
    await expect(policy.resolve('10.42.1.5', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });

  it('denies forbidden ports and deny ranges even inside an allow range', async () => {
    const policy = new NetworkTargetPolicy(policyConfig);
    await expect(policy.resolve('10.42.1.5', 80)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
    await expect(policy.resolve('10.42.255.5', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });

  it('normalizes mapped IPv6 before applying IPv4 network policy', async () => {
    const policy = new NetworkTargetPolicy(policyConfig);
    await expect(policy.resolve('::ffff:10.42.1.5', 22)).resolves.toMatchObject({ address: '10.42.1.5' });
    await expect(policy.resolve('::ffff:127.0.0.1', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
    await expect(policy.resolve('::ffff:169.254.169.254', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });

  it('validates every DNS answer, including mixed IPv4/IPv6 results', async () => {
    const policy = new NetworkTargetPolicy(policyConfig, async () => [
      { address: '10.42.1.5' }, { address: '::1' },
    ]);
    await expect(policy.resolve('dut.lab.example', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });

  it('returns a pinned normalized address without a second DNS lookup', async () => {
    let calls = 0;
    const policy = new NetworkTargetPolicy(policyConfig, async () => {
      calls += 1;
      return [{ address: calls === 1 ? '2001:db8:42::5' : '127.0.0.1' }];
    });
    const target = await policy.resolve('DUT.LAB.EXAMPLE.', 2222);
    expect(target.address).toBe('2001:db8:42::5');
    expect(target.port).toBe(2222);
    expect(calls).toBe(1);
  });

  it('enforces suffix boundaries and rejects scoped addresses', async () => {
    let calls = 0;
    const policy = new NetworkTargetPolicy(policyConfig, async () => {
      calls += 1;
      return [{ address: '10.42.1.5' }];
    });
    await expect(policy.resolve('evillab.example', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
    await expect(policy.resolve('lab.example.attacker.test', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
    await expect(policy.resolve('fe80::1%eth0', 22)).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
    expect(calls).toBe(0);
  });
});

describe('independent review: saved credential integrity', () => {
  it('uses fresh nonces and decrypts only for the original owner and record', () => {
    const cipher = new CredentialCipher(randomBytes(32));
    const owner = randomUUID();
    const id = randomUUID();
    const material = { type: 'password' as const, password: 'test-only-secret' };
    const first = cipher.encrypt(owner, id, material);
    const second = cipher.encrypt(owner, id, material);
    expect(first).not.toBe(second);
    expect(first).not.toContain(material.password);
    expect(cipher.decrypt(owner, id, first)).toEqual(material);
    expect(() => cipher.decrypt(randomUUID(), id, first)).toThrow();
    expect(() => cipher.decrypt(owner, randomUUID(), first)).toThrow();
  });

  it('rejects ciphertext tampering and a different deployment key', () => {
    const cipher = new CredentialCipher(randomBytes(32));
    const owner = randomUUID();
    const id = randomUUID();
    const value = cipher.encrypt(owner, id, { type: 'key', privateKey: 'fixture-only' });
    const altered = Buffer.from(value, 'base64');
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
    expect(() => cipher.decrypt(owner, id, altered.toString('base64'))).toThrow();
    expect(() => new CredentialCipher(randomBytes(32)).decrypt(owner, id, value)).toThrow();
  });
});
