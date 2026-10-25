// Delivery of a one-time code. The platform's WhatsApp account is merchant-facing
// only and sends plain text (no approved authentication template), so it is NOT
// used here. Choosing a real SMS/WhatsApp provider (templates, sender-ID
// registration per country, cost) is an owner decision, so the only
// implementation is a stub that delivers nothing.
export interface OtpChannel {
  // `to` is E.164. Must never log `to` or `code`. Throwing is allowed; the caller
  // swallows it so a delivery failure answers like a success.
  send(to: string, code: string, ctx: { shopId: number }): Promise<void>;
}

export const OTP_CHANNEL = Symbol('OTP_CHANNEL');

// Test-only outbox: filled when NODE_ENV === 'test' and never otherwise, so a
// production process cannot accumulate codes in memory.
const outbox: { shopId: number; to: string; code: string }[] = [];
export const testOtpOutbox = {
  last: (to: string) => [...outbox].reverse().find((m) => m.to === to),
  all: () => [...outbox],
  clear: () => {
    outbox.length = 0;
  },
};

export class StubOtpChannel implements OtpChannel {
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(to: string, code: string, ctx: { shopId: number }): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      outbox.push({ shopId: ctx.shopId, to, code });
    }
  }
}
