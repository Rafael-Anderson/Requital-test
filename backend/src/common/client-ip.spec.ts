import { throttleKey } from './client-ip';

describe('throttleKey', () => {
  it('keeps IPv4 as is', () => {
    expect(throttleKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('treats an IPv4-mapped address as the IPv4 client, in dotted and hex spelling', () => {
    expect(throttleKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(throttleKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(throttleKey('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('buckets an IPv6 client by its /64, however the address is spelled', () => {
    const key = throttleKey('2001:db8:aa:bb::1');
    expect(key).toBe('2001:db8:aa:bb::/64');
    expect(throttleKey('2001:0db8:00aa:00bb:dead:beef:0:9')).toBe(key);
    expect(throttleKey('2001:DB8:AA:BB:ffff:ffff:ffff:ffff')).toBe(key);
    expect(throttleKey('2001:db8:aa:bc::1')).not.toBe(key);
  });

  it('expands "::" before taking the prefix', () => {
    expect(throttleKey('::1')).toBe('0:0:0:0::/64');
    expect(throttleKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(throttleKey('2001:db8:1::')).toBe('2001:db8:1:0::/64');
  });

  it('drops a zone id', () => {
    expect(throttleKey('fe80::1%eth0')).toBe(throttleKey('fe80::2'));
  });

  it('never throws on a missing address', () => {
    expect(throttleKey(undefined)).toBe('unknown');
    expect(throttleKey('')).toBe('unknown');
  });
});
