import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  RESEND_DOMAINS_ASSUMPTIONS as A,
  mapProviderStatus,
  type ProviderDomainStatus,
} from './sending-domain-platform-assumptions';

// One DNS record the merchant must publish. Public values only.
export interface SendingDomainRecord {
  type: string; // MX | TXT | CNAME ...
  name: string;
  value: string;
  priority?: number;
  label?: string; // provider's own purpose label (SPF, DKIM, ...)
}

export interface ProviderDomain {
  providerId: string;
  status: ProviderDomainStatus;
  records: SendingDomainRecord[];
}

// The seam. Production binds ResendDomainsClient (or NotConfigured), tests bind
// FakeSendingDomainsClient. Every method may throw; callers treat a throw as
// "provider unavailable" and never let it block a transactional email.
export interface SendingDomainsClient {
  createDomain(domain: string): Promise<ProviderDomain>;
  getDomain(providerId: string): Promise<ProviderDomain>;
  requestVerification(providerId: string): Promise<void>;
  deleteDomain(providerId: string): Promise<void>;
}

export const SENDING_DOMAINS_CLIENT = Symbol('SENDING_DOMAINS_CLIENT');

interface RawRecord {
  record?: string;
  type?: string;
  name?: string;
  value?: string;
  priority?: number;
}
interface RawDomain {
  id?: string;
  status?: string;
  records?: RawRecord[];
  message?: string;
}

// Plain fetch against Resend's domains API; see
// sending-domain-platform-assumptions.ts: every shape here is UNVERIFIED and no
// test or code path in this repo calls it for real. The key is read per call
// and never logged, thrown or stored.
@Injectable()
export class ResendDomainsClient implements SendingDomainsClient {
  constructor(private readonly apiKey: string) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RawDomain> {
    const res = await fetch(`${A.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as RawDomain;
    if (!res.ok) {
      // Status code only: the provider's message could echo request detail.
      throw new ServiceUnavailableException(
        `Sending domain provider error (${res.status})`,
      );
    }
    return data;
  }

  private static shape(d: RawDomain, fallbackId?: string): ProviderDomain {
    return {
      providerId: d.id ?? fallbackId ?? '',
      status: mapProviderStatus(d.status),
      records: (d.records ?? []).map((r) => ({
        type: r.type ?? '',
        name: r.name ?? '',
        value: r.value ?? '',
        ...(r.priority !== undefined ? { priority: r.priority } : {}),
        ...(r.record ? { label: r.record } : {}),
      })),
    };
  }

  async createDomain(domain: string): Promise<ProviderDomain> {
    const d = await this.call('POST', '', { [A.createBodyField]: domain });
    if (!d.id)
      throw new ServiceUnavailableException('Sending domain provider error');
    return ResendDomainsClient.shape(d);
  }

  async getDomain(providerId: string): Promise<ProviderDomain> {
    return ResendDomainsClient.shape(
      await this.call('GET', `/${encodeURIComponent(providerId)}`),
      providerId,
    );
  }

  async requestVerification(providerId: string): Promise<void> {
    await this.call('POST', `/${encodeURIComponent(providerId)}/verify`);
  }

  async deleteDomain(providerId: string): Promise<void> {
    await this.call('DELETE', `/${encodeURIComponent(providerId)}`);
  }
}

// Bound when RESEND_DOMAINS_API_KEY is unset: the feature is visibly
// unavailable rather than silently doing nothing.
@Injectable()
export class NotConfiguredSendingDomainsClient implements SendingDomainsClient {
  private fail(): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableException(
        'Sending domains are not available on this platform yet.',
      ),
    );
  }
  createDomain(): Promise<ProviderDomain> {
    return this.fail();
  }
  getDomain(): Promise<ProviderDomain> {
    return this.fail();
  }
  requestVerification(): Promise<void> {
    return this.fail();
  }
  deleteDomain(): Promise<void> {
    return this.fail();
  }
}
