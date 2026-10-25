import { ServiceUnavailableException } from '@nestjs/common';
import type {
  ProviderDomain,
  SendingDomainRecord,
  SendingDomainsClient,
} from './sending-domains.client';

// In-repo stand-in for the provider. Nothing here touches the network.
// Tests drive it: setStatus() flips a domain, failNext() makes the next call
// throw, calls[] records what the service asked for.
export class FakeSendingDomainsClient implements SendingDomainsClient {
  readonly calls: string[] = [];
  private seq = 0;
  private readonly domains = new Map<
    string,
    ProviderDomain & { name: string }
  >();
  private failures = 0;

  failNext(n = 1) {
    this.failures = n;
  }
  setStatus(providerId: string, status: ProviderDomain['status']) {
    const d = this.domains.get(providerId);
    if (d) d.status = status;
  }
  idFor(name: string): string | undefined {
    return [...this.domains.values()].find((d) => d.name === name)?.providerId;
  }

  private maybeFail() {
    if (this.failures > 0) {
      this.failures--;
      throw new ServiceUnavailableException('fake provider down');
    }
  }

  private static records(name: string): SendingDomainRecord[] {
    return [
      {
        type: 'MX',
        name: `send.${name}`,
        value: 'feedback-smtp.fake.test',
        priority: 10,
        label: 'SPF',
      },
      {
        type: 'TXT',
        name: `send.${name}`,
        value: 'v=spf1 include:fake.test ~all',
        label: 'SPF',
      },
      {
        type: 'TXT',
        name: `fake._domainkey.${name}`,
        value: 'p=FAKEPUBLICKEY',
        label: 'DKIM',
      },
    ];
  }

  createDomain(name: string): Promise<ProviderDomain> {
    this.calls.push(`create:${name}`);
    this.maybeFail();
    const providerId = `fake-dom-${++this.seq}`;
    const d = {
      providerId,
      name,
      status: 'pending' as const,
      records: FakeSendingDomainsClient.records(name),
    };
    this.domains.set(providerId, d);
    return Promise.resolve({
      providerId,
      status: d.status,
      records: d.records,
    });
  }
  getDomain(providerId: string): Promise<ProviderDomain> {
    this.calls.push(`get:${providerId}`);
    this.maybeFail();
    const d = this.domains.get(providerId);
    if (!d)
      return Promise.reject(
        new ServiceUnavailableException('fake: unknown domain'),
      );
    return Promise.resolve({
      providerId,
      status: d.status,
      records: d.records,
    });
  }
  requestVerification(providerId: string): Promise<void> {
    this.calls.push(`verify:${providerId}`);
    this.maybeFail();
    return Promise.resolve();
  }
  deleteDomain(providerId: string): Promise<void> {
    this.calls.push(`delete:${providerId}`);
    this.maybeFail();
    this.domains.delete(providerId);
    return Promise.resolve();
  }
}
