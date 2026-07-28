import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopService } from '../shop/shop.service';
import type { TenantContext } from '../common/tenant-context';
import { decrypt, encrypt } from '../common/crypto';
import {
  CARD_PROCESSOR_PROVIDERS,
  PAYMENT_GATEWAY_PROVIDERS,
  PROVIDER_CREDENTIAL_FIELDS,
  type PaymentGatewayProvider,
} from './provider-credentials';

export interface ProviderSettingsResponse {
  provider: string;
  enabled: boolean;
  isCardProcessor: boolean;
  hasCredentials: boolean;
  // Never the real value — e.g. { secretKey: '••••1234' }. See maskValue.
  maskedCredentials: Record<string, string> | null;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '•'.repeat(Math.max(value.length, 4));
  return `••••${value.slice(-4)}`;
}

function isCardProcessor(provider: string): provider is PaymentGatewayProvider {
  return (CARD_PROCESSOR_PROVIDERS as string[]).includes(provider);
}

@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopService: ShopService,
  ) {}

  async findAll(ctx: TenantContext): Promise<ProviderSettingsResponse[]> {
    const [shop, rows] = await Promise.all([
      this.prisma.shop.findUniqueOrThrow({ where: { id: ctx.shopId } }),
      this.prisma.shoppaymentprovider.findMany({ where: { shopId: ctx.shopId } }),
    ]);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    const gatewayRows = PAYMENT_GATEWAY_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      const enabled = this.resolveEnabled(provider, byProvider);
      return {
        provider,
        enabled,
        isCardProcessor: isCardProcessor(provider),
        hasCredentials: !!row?.credentials,
        maskedCredentials: row?.credentials ? this.maskCredentials(provider, row.credentials) : null,
      };
    });

    // Cash on Delivery — synthesized from the existing shop booleans, not a
    // shoppaymentprovider row (see the model's own doc comment for why).
    // Shown as "on" only when both the delivery and pickup COD flags agree;
    // if a merchant has split them via the outlet edit tabs (the existing,
    // more granular surface for these same two fields), this page reports
    // whichever of the two is true rather than claiming false precision —
    // toggling COD *from this page* sets both together.
    const codRow: ProviderSettingsResponse = {
      provider: 'cod',
      enabled: shop.deliveryPaymentCashOnDelivery || shop.pickupPaymentCashOnPickup,
      isCardProcessor: false,
      hasCredentials: false,
      maskedCredentials: null,
    };

    return [...gatewayRows, codRow];
  }

  async setProvider(
    ctx: TenantContext,
    provider: string,
    dto: { enabled?: boolean; credentials?: Record<string, string> },
  ): Promise<ProviderSettingsResponse[]> {
    if (provider === 'cod') {
      if (dto.enabled === undefined) {
        throw new BadRequestException('enabled is required to update Cash on Delivery');
      }
      // Reuses ShopService.update so the existing "at least one delivery/
      // pickup payment method" validation still applies — not a parallel
      // write path that could disable every payment method at once.
      await this.shopService.update(ctx, {
        deliveryPaymentCashOnDelivery: dto.enabled,
        pickupPaymentCashOnPickup: dto.enabled,
      });
      return this.findAll(ctx);
    }

    if (!(PAYMENT_GATEWAY_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException(`Unknown payment provider '${provider}'`);
    }
    const typedProvider = provider as PaymentGatewayProvider;

    if (dto.credentials) {
      this.assertValidCredentials(typedProvider, dto.credentials);
    }

    const existingRows = await this.prisma.shoppaymentprovider.findMany({ where: { shopId: ctx.shopId } });
    const byProvider = new Map(existingRows.map((r) => [r.provider, r]));

    if (dto.enabled === true && isCardProcessor(typedProvider)) {
      const other = typedProvider === 'stripe' ? 'nomod' : 'stripe';
      if (this.resolveEnabled(other, byProvider)) {
        const label = (name: string) => name[0].toUpperCase() + name.slice(1);
        throw new BadRequestException(`Disable ${label(other)} before enabling ${label(typedProvider)}`);
      }
    }

    // enabled defaults to today's *effective* state (not a hardcoded false)
    // when creating a row for the first time purely to save credentials —
    // otherwise typing in an API key with the toggle untouched would
    // silently flip a card processor that was implicitly on (no row yet,
    // "stripe" is the legacy default) to explicitly off the moment a row
    // gets created. See resolveEnabled/defaultEnabled.
    const nextEnabled = dto.enabled ?? this.resolveEnabled(typedProvider, byProvider);
    const encryptedCredentials = dto.credentials ? encrypt(JSON.stringify(dto.credentials)) : undefined;

    await this.prisma.shoppaymentprovider.upsert({
      where: { shopId_provider: { shopId: ctx.shopId, provider: typedProvider } },
      create: {
        shopId: ctx.shopId,
        provider: typedProvider,
        enabled: nextEnabled,
        credentials: encryptedCredentials ?? null,
      },
      update: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(encryptedCredentials !== undefined && { credentials: encryptedCredentials }),
      },
    });

    // Keeps shop.paymentGateway (still what card_online checkout resolution
    // reads — see PublicService.createOrder) in sync with whichever card
    // processor is now active, so the rest of the existing checkout flow
    // needs no further changes.
    if (dto.enabled === true && isCardProcessor(typedProvider)) {
      await this.prisma.shop.update({ where: { id: ctx.shopId }, data: { paymentGateway: typedProvider } });
    }

    return this.findAll(ctx);
  }

  // Decrypted server-side only to resolve the credentials a provider call
  // actually needs (PublicService.createOrder, PaymentsService) — never
  // returned to any client. Returns null when the shop has no row (or no
  // saved credentials) for this provider, so callers fall back to whatever
  // env-var default the provider implementation itself has (Stripe today).
  async resolveCredentials(shopId: number, provider: string): Promise<Record<string, string> | null> {
    const row = await this.prisma.shoppaymentprovider.findUnique({
      where: { shopId_provider: { shopId, provider } },
    });
    if (!row?.credentials) return null;
    return JSON.parse(decrypt(row.credentials)) as Record<string, string>;
  }

  // Whether `provider` (an online-payment provider, not cod) should be
  // treated as available for checkout right now — used by
  // PublicService.assertPaymentMethodAvailable/createOrder, mirroring
  // exactly the same enabled/default-state logic findAll uses for display,
  // so what the storefront accepts always matches what the settings page
  // shows as "on".
  async isEnabled(shopId: number, provider: string): Promise<boolean> {
    if (!(PAYMENT_GATEWAY_PROVIDERS as readonly string[]).includes(provider)) return false;
    const allRows = await this.prisma.shoppaymentprovider.findMany({ where: { shopId } });
    return this.resolveEnabled(provider as PaymentGatewayProvider, new Map(allRows.map((r) => [r.provider, r])));
  }

  // Single source of truth for "is this provider enabled right now": the
  // real row if one exists, otherwise its no-row default. Every exclusivity
  // check, GET /payment-settings response, and storefront-facing isEnabled
  // call goes through this — the earlier version of the exclusivity check
  // called defaultEnabled(other, ...) directly, which assumes the caller
  // already confirmed `other` has no row; skipping that check meant
  // disabling Stripe (which creates a real enabled:false row) was still
  // read as "enabled" by defaultEnabled's own no-row logic, permanently
  // blocking Nomod from ever being enabled after Stripe's first save. Fixed
  // by always routing through this method instead.
  private resolveEnabled(
    provider: PaymentGatewayProvider,
    rows: Map<string, { enabled: boolean }>,
  ): boolean {
    const row = rows.get(provider);
    if (row) return row.enabled;
    return this.defaultEnabled(provider, rows);
  }

  // No row for this provider yet — what should it read as? Only nomod/
  // stripe have a legacy default (stripe=true, matching shop.paymentGateway's
  // own default and every pre-existing shop's real behavior); paypal/tabby/
  // tamara are new, opt-in additions with no prior behavior to preserve, so
  // "no row" simply means "not enabled" for them. Only ever called (via
  // resolveEnabled) once the caller has confirmed there's no row for
  // `provider` itself — it still needs to check the *other* card
  // processor's row directly (not recurse through resolveEnabled) since
  // that one's presence/absence is exactly what determines this default.
  private defaultEnabled(
    provider: PaymentGatewayProvider,
    rows: Map<string, { enabled: boolean }>,
  ): boolean {
    if (!isCardProcessor(provider)) return false;
    const other = provider === 'stripe' ? 'nomod' : 'stripe';
    if (rows.get(other)?.enabled) return false;
    return provider === 'stripe';
  }

  private assertValidCredentials(provider: PaymentGatewayProvider, credentials: Record<string, string>) {
    const validKeys = new Set(PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
    for (const key of Object.keys(credentials)) {
      if (!validKeys.has(key)) {
        throw new BadRequestException(`Unknown credential field '${key}' for ${provider}`);
      }
    }
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) {
      const value = credentials[field.key];
      if (value !== undefined && !value.trim()) {
        throw new BadRequestException(`${field.label} cannot be blank`);
      }
    }
  }

  private maskCredentials(provider: PaymentGatewayProvider, encryptedCredentials: string): Record<string, string> {
    const decrypted = JSON.parse(decrypt(encryptedCredentials)) as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) {
      if (decrypted[field.key]) masked[field.key] = maskValue(decrypted[field.key]);
    }
    return masked;
  }
}
