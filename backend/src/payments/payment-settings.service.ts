import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { ShopService } from '../shop/shop.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import type { PaymentProvider } from './payment-provider.interface';
import type { TenantContext } from '../common/tenant-context';
import { randomBytes } from 'crypto';
import { decrypt, encrypt } from '../common/crypto';
import { FeaturesService } from '../features/features.service';
import { NomodConfigError, resolveNomodBase } from './nomod/nomod-client';
import {
  gatewayHasCurrencyRule,
  isGatewayCurrencyBlocked,
} from './blocked-gateway-currencies';
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
  // Never the real value — e.g. { secretKey: '••••1234' }. See maskValue. Only the
  // SECRET fields of a provider ever appear here.
  maskedCredentials: Record<string, string> | null;
  // false when the platform has not granted this provider to the shop (Nomod, behind
  // the nomod_payments feature): the admin shows it as unavailable. Absent = true.
  available?: boolean;
  // The provider's plain (non-secret) settings, as saved (Nomod: baseUrl,
  // allowPartialRefunds). Never contains a secret field.
  publicValues?: Record<string, string>;
  // Nomod only: the shop-scoped, unguessable webhook path the merchant pastes into
  // Nomod (the admin prefixes the API origin). Null until it is first generated.
  webhookPath?: string | null;
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
    private readonly db: DatabaseService,
    private readonly shopService: ShopService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly features: FeaturesService,
  ) {}

  async findAll(ctx: TenantContext): Promise<ProviderSettingsResponse[]> {
    const [shopRows, rows] = await Promise.all([
      this.db.query<RowDataPacket[]>(`SELECT * FROM shop WHERE id = ?`, [
        ctx.shopId,
      ]),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM shoppaymentprovider WHERE shopId = ?`,
        [ctx.shopId],
      ),
    ]);
    const shop = shopRows[0];
    const byProvider = new Map(
      rows.map((r) => [
        r.provider as string,
        r as { enabled: boolean; credentials: string | null },
      ]),
    );
    const nomodGranted = await this.features.isEnabled(
      ctx.shopId,
      'nomod_payments',
    );

    const gatewayRows = PAYMENT_GATEWAY_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      // Nomod reads as enabled only while the platform grant is on too (the same
      // answer the storefront gets from isEnabled).
      const enabled =
        this.resolveEnabled(provider, byProvider) &&
        (provider !== 'nomod' || nomodGranted);
      const decrypted = row?.credentials
        ? (JSON.parse(decrypt(row.credentials)) as Record<string, string>)
        : null;
      const response: ProviderSettingsResponse = {
        provider,
        enabled,
        isCardProcessor: isCardProcessor(provider),
        hasCredentials: !!row?.credentials,
        maskedCredentials: decrypted
          ? this.maskCredentials(provider, decrypted)
          : null,
      };
      if (provider === 'nomod') {
        response.available = nomodGranted;
        response.publicValues = decrypted
          ? this.publicValues(provider, decrypted)
          : {};
        const token = (row as { webhookToken?: string | null } | undefined)
          ?.webhookToken;
        response.webhookPath = token
          ? `/payments/webhook/nomod/${token}`
          : null;
      }
      return response;
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
      enabled: Boolean(
        shop.deliveryPaymentCashOnDelivery || shop.pickupPaymentCashOnPickup,
      ),
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
        throw new BadRequestException(
          'enabled is required to update Cash on Delivery',
        );
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
    // Nomod is a platform-granted feature: it cannot be switched on (and its
    // settings cannot be created) for a shop the platform has not granted it to.
    if (
      typedProvider === 'nomod' &&
      (dto.enabled === true || dto.credentials) &&
      !(await this.features.isEnabled(ctx.shopId, 'nomod_payments'))
    ) {
      throw new ForbiddenException('Nomod is not available for this shop yet');
    }

    const existingRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM shoppaymentprovider WHERE shopId = ?`,
      [ctx.shopId],
    );
    const byProvider = new Map(
      existingRows.map((r) => [
        r.provider as string,
        r as { enabled: boolean; credentials: string | null },
      ]),
    );

    if (dto.enabled === true && isCardProcessor(typedProvider)) {
      const other = typedProvider === 'stripe' ? 'nomod' : 'stripe';
      if (this.resolveEnabled(other, byProvider)) {
        const label = (name: string) => name[0].toUpperCase() + name.slice(1);
        throw new BadRequestException(
          `Disable ${label(other)} before enabling ${label(typedProvider)}`,
        );
      }
    }

    // enabled defaults to today's *effective* state (not a hardcoded false)
    // when creating a row for the first time purely to save credentials —
    // otherwise typing in an API key with the toggle untouched would
    // silently flip a card processor that was implicitly on (no row yet,
    // "stripe" is the legacy default) to explicitly off the moment a row
    // gets created. See resolveEnabled/defaultEnabled.
    const nextEnabled =
      dto.enabled ?? this.resolveEnabled(typedProvider, byProvider);

    // Nomod keeps non-secret settings (base URL, partial refunds) beside its two
    // secrets in the same encrypted blob, so a save of ONE field must not wipe the
    // others: new values are merged over what is stored, and a blank optional field
    // clears it. (The other gateways keep their replace-the-blob behaviour.)
    let nextCredentials = dto.credentials;
    if (typedProvider === 'nomod') {
      const existing = await this.resolveCredentials(ctx.shopId, 'nomod');
      if (dto.credentials) {
        nextCredentials = this.mergeNomodCredentials(
          existing ?? {},
          dto.credentials,
        );
      }
      if (dto.enabled === true) {
        const effective = nextCredentials ?? existing ?? {};
        if (!effective.apiKey?.trim() || !effective.webhookSecret?.trim()) {
          throw new BadRequestException(
            'Add the Nomod API key and the webhook signing secret before enabling Nomod',
          );
        }
      }
    }
    const encryptedCredentials = nextCredentials
      ? encrypt(JSON.stringify(nextCredentials))
      : undefined;

    // Conditional ON DUPLICATE KEY UPDATE clause: only overwrite `enabled`/
    // `credentials` on an existing row when this call actually touched
    // them — a plain upsert()-style "always overwrite with the create
    // value" would wipe a saved credential every time the toggle alone is
    // flipped, or vice versa.
    const updateParts: string[] = ['updatedAt = ?'];
    const updateParams: QueryParam[] = [new Date()];
    if (dto.enabled !== undefined) {
      updateParts.push('enabled = ?');
      updateParams.push(dto.enabled);
    }
    if (encryptedCredentials !== undefined) {
      updateParts.push('credentials = ?');
      updateParams.push(encryptedCredentials);
    }
    await this.db.execute(
      `INSERT INTO shoppaymentprovider (shopId, provider, enabled, credentials)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${updateParts.join(', ')}`,
      [
        ctx.shopId,
        typedProvider,
        nextEnabled,
        encryptedCredentials ?? null,
        ...updateParams,
      ],
    );

    if (typedProvider === 'nomod') {
      await this.ensureNomodWebhookToken(ctx.shopId);
    }

    // Keeps shop.paymentGateway (still what card_online checkout resolution
    // reads — see PublicService.createOrder) in sync with whichever card
    // processor is now active, so the rest of the existing checkout flow
    // needs no further changes.
    if (dto.enabled === true && isCardProcessor(typedProvider)) {
      await this.db.execute(`UPDATE shop SET paymentGateway = ? WHERE id = ?`, [
        typedProvider,
        ctx.shopId,
      ]);
    }

    return this.findAll(ctx);
  }

  // Decrypted server-side only to resolve the credentials a provider call
  // actually needs (PublicService.createOrder, PaymentsService) — never
  // returned to any client. Returns null when the shop has no row (or no
  // saved credentials) for this provider, so callers fall back to whatever
  // env-var default the provider implementation itself has (Stripe today).
  async resolveCredentials(
    shopId: number,
    provider: string,
  ): Promise<Record<string, string> | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT credentials FROM shoppaymentprovider WHERE shopId = ? AND provider = ?`,
      [shopId, provider],
    );
    const credentials = rows[0]?.credentials as string | null | undefined;
    if (!credentials) return null;
    return JSON.parse(decrypt(credentials)) as Record<string, string>;
  }

  // Public-safe projection: a Tabby/Tamara "public key" is meant to be
  // embedded client-side (their own installment-promo widget scripts need
  // it directly) — unlike every other credential field this service
  // resolves, which are server-side-only secrets. Used by
  // PublicService.getShop's tabbyPublicKey/tamaraPublicKey fields, which the
  // storefront PDP reads to decide whether to render each widget at all.
  // Returns null unless the provider is BOTH enabled (matching the same
  // isEnabled() checkout-availability check used everywhere else) AND has a
  // real key (per-shop credential or the platform env var fallback) — a
  // merchant who has explicitly turned Tabby/Tamara off for checkout
  // shouldn't still advertise "4 payments of X" on the PDP.
  async resolvePublicWidgetKey(
    shopId: number,
    provider: 'tabby' | 'tamara',
  ): Promise<string | null> {
    if (!(await this.isEnabled(shopId, provider))) return null;
    const credentials = await this.resolveCredentials(shopId, provider);
    const envVar =
      provider === 'tabby' ? 'TABBY_PUBLIC_KEY' : 'TAMARA_PUBLIC_KEY';
    const key = credentials?.publicKey ?? process.env[envVar];
    return key?.trim() ? key : null;
  }

  // TabbyPromo's widget constructor needs `merchantCode` alongside
  // `publicKey` — a genuinely distinct value per Tabby's own docs ("based on
  // your store currency"), not just the public key under another name. Most
  // shops won't have filled in the optional Merchant Code field, so this
  // falls back to the public key rather than resolving to null and hiding
  // the whole Tabby widget row for them — same gate (enabled + a real key)
  // as resolvePublicWidgetKey, since a merchant code with no public key (or
  // Tabby disabled) is meaningless on its own.
  async resolveTabbyMerchantCode(shopId: number): Promise<string | null> {
    if (!(await this.isEnabled(shopId, 'tabby'))) return null;
    const credentials = await this.resolveCredentials(shopId, 'tabby');
    const key =
      credentials?.merchantCode?.trim() ||
      credentials?.publicKey?.trim() ||
      process.env.TABBY_PUBLIC_KEY;
    return key?.trim() ? key : null;
  }

  // Whether `provider` (an online-payment provider, not cod) should be
  // treated as available for checkout right now — used by
  // PublicService.assertPaymentMethodAvailable/createOrder, mirroring
  // exactly the same enabled/default-state logic findAll uses for display,
  // so what the storefront accepts always matches what the settings page
  // shows as "on".
  async isEnabled(shopId: number, provider: string): Promise<boolean> {
    if (!(PAYMENT_GATEWAY_PROVIDERS as readonly string[]).includes(provider))
      return false;
    const allRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM shoppaymentprovider WHERE shopId = ?`,
      [shopId],
    );
    const enabled = this.resolveEnabled(
      provider as PaymentGatewayProvider,
      new Map(
        allRows.map((r) => [
          r.provider as string,
          r as { enabled: boolean; credentials: string | null },
        ]),
      ),
    );
    // Nomod is also behind the platform grant: without it the storefront never
    // offers it, whatever the merchant toggled.
    if (enabled && provider === 'nomod') {
      return this.features.isEnabled(shopId, 'nomod_payments');
    }
    return enabled;
  }

  // F8: enabled AND able to take a payment right now, i.e. the provider is
  // registered and says it has real credentials (the shop's own, else the
  // platform env fallback). A toggle alone is not enough: a shop that never
  // entered keys still reads "enabled" for Stripe (the legacy no-row default), and
  // before this the storefront offered "Pay online" and the order was placed
  // BEFORE the gateway said no. The Nomod/PayTabs/Telr structural stubs answer
  // false whatever was saved. Never a replacement for the provider's own
  // MANDATORY GUARD in createCheckoutSession (that stays, for every other call
  // path). A provider that does not implement isUsable (a test double) is usable.
  async isUsable(shopId: number, provider: string): Promise<boolean> {
    if (!(await this.isEnabled(shopId, provider))) return false;
    // Blocked for the shop's current currency (KWD/BHD/OMR on Stripe): not a
    // payment method the shopper can complete, so getShop hides it and the
    // order is rejected before it exists. Provider-name keyed read, so only
    // blocked gateways cost the extra query.
    if (gatewayHasCurrencyRule(provider)) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT currency FROM shop WHERE id = ?`,
        [shopId],
      );
      const currency = rows[0]?.currency as string | undefined;
      if (currency && isGatewayCurrencyBlocked(provider, currency))
        return false;
    }
    let impl: PaymentProvider;
    try {
      impl = this.providerRegistry.get(provider);
    } catch {
      return false;
    }
    if (!impl.isUsable) return true;
    return impl.isUsable(await this.resolveCredentials(shopId, provider));
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

  private assertValidCredentials(
    provider: PaymentGatewayProvider,
    credentials: Record<string, string>,
  ) {
    const validKeys = new Set(
      PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key),
    );
    for (const key of Object.keys(credentials)) {
      if (!validKeys.has(key)) {
        throw new BadRequestException(
          `Unknown credential field '${key}' for ${provider}`,
        );
      }
    }
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) {
      const value = credentials[field.key];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        throw new BadRequestException(`${field.label} must be text`);
      }
      // An optional field may be saved blank (it clears the setting).
      if (!value.trim() && !field.optional) {
        throw new BadRequestException(`${field.label} cannot be blank`);
      }
    }
    if (provider === 'nomod') this.assertValidNomodSettings(credentials);
  }

  private assertValidNomodSettings(credentials: Record<string, string>) {
    const base = credentials.baseUrl?.trim();
    if (base) {
      try {
        resolveNomodBase(base);
      } catch (err) {
        throw new BadRequestException(
          err instanceof NomodConfigError
            ? err.message
            : 'Invalid Nomod base URL',
        );
      }
    }
    const partial = credentials.allowPartialRefunds?.trim();
    if (partial && partial !== 'true' && partial !== 'false') {
      throw new BadRequestException(
        'Partial refunds must be set to true or false',
      );
    }
  }

  // New values over the stored ones; a blank optional field removes its key.
  private mergeNomodCredentials(
    existing: Record<string, string>,
    incoming: Record<string, string>,
  ): Record<string, string> {
    const merged = { ...existing };
    for (const field of PROVIDER_CREDENTIAL_FIELDS.nomod) {
      const value = incoming[field.key];
      if (value === undefined) continue;
      if (!value.trim()) delete merged[field.key];
      else merged[field.key] = value.trim();
    }
    return merged;
  }

  // The unguessable per-shop token of the Nomod webhook URL: 32 random bytes as 64
  // hex characters, created once. A row is created (disabled, no credentials) when
  // the shop has none yet, so the URL can be shown before any key is saved.
  async ensureNomodWebhookToken(shopId: number): Promise<string> {
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT webhookToken FROM shoppaymentprovider WHERE shopId = ? AND provider = 'nomod'`,
      [shopId],
    );
    const current = existing[0]?.webhookToken as string | null | undefined;
    if (current) return current;
    await this.db.execute(
      `INSERT INTO shoppaymentprovider (shopId, provider, enabled, webhookToken)
       VALUES (?, 'nomod', false, ?)
       ON DUPLICATE KEY UPDATE webhookToken = COALESCE(webhookToken, VALUES(webhookToken))`,
      [shopId, randomBytes(32).toString('hex')],
    );
    const after = await this.db.query<RowDataPacket[]>(
      `SELECT webhookToken FROM shoppaymentprovider WHERE shopId = ? AND provider = 'nomod'`,
      [shopId],
    );
    return after[0].webhookToken as string;
  }

  // Replaces the token (the old URL stops working at once). The merchant must paste
  // the new URL into Nomod.
  async rotateNomodWebhookToken(shopId: number): Promise<string> {
    await this.ensureNomodWebhookToken(shopId);
    const token = randomBytes(32).toString('hex');
    await this.db.execute(
      `UPDATE shoppaymentprovider SET webhookToken = ? WHERE shopId = ? AND provider = 'nomod'`,
      [token, shopId],
    );
    return token;
  }

  // Only the SECRET fields, each as a masked tail; plain settings come back through
  // publicValues instead.
  private maskCredentials(
    provider: PaymentGatewayProvider,
    decrypted: Record<string, string>,
  ): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) {
      if (field.secret === false) continue;
      if (decrypted[field.key])
        masked[field.key] = maskValue(decrypted[field.key]);
    }
    return masked;
  }

  private publicValues(
    provider: PaymentGatewayProvider,
    decrypted: Record<string, string>,
  ): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) {
      if (field.secret !== false) continue;
      if (decrypted[field.key]) values[field.key] = decrypted[field.key];
    }
    return values;
  }
}
