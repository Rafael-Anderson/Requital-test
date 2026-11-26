import { createServer, type Server } from 'node:http';

// A stand-in for the Stripe API, for the custom-order pay-link spec. The backend
// sends its Stripe calls here only when it was started with
// E2E_FAKE_STRIPE_URL pointing at this server (honoured outside production and
// for a local origin only, see backend stripe-payment.provider.ts fakeStripeApi).
// No real Stripe call, no real payment.
//
// POST /v1/checkout/sessions -> a session whose url is this server's own fake
// gateway page; GET /gateway/<id> -> a page with a "Complete payment" link to
// the session's success_url.
export const FAKE_STRIPE_PORT = Number(process.env.E2E_FAKE_STRIPE_PORT ?? 12111);

export interface FakeSession {
  id: string;
  orderId: number;
  amount: number;
  currency: string;
  successUrl: string;
}

export function startFakeStripe(): Promise<{ server: Server; sessions: FakeSession[] }> {
  const sessions: FakeSession[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${FAKE_STRIPE_PORT}`);
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const form = new URLSearchParams(body);
        const s: FakeSession = {
          id: `cs_test_fake_${sessions.length + 1}_${Date.now()}`,
          orderId: Number(form.get('metadata[orderId]')),
          amount: Number(form.get('line_items[0][price_data][unit_amount]')),
          currency: form.get('line_items[0][price_data][currency]') ?? '',
          successUrl: form.get('success_url') ?? '',
        };
        sessions.push(s);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: s.id,
            object: 'checkout.session',
            url: `http://127.0.0.1:${FAKE_STRIPE_PORT}/gateway/${s.id}`,
            payment_status: 'unpaid',
            status: 'open',
          }),
        );
        return;
      }
      const gw = /^\/gateway\/([\w]+)$/.exec(url.pathname);
      const s = gw && sessions.find((x) => x.id === gw[1]);
      if (req.method === 'GET' && s) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<!doctype html><title>Fake gateway</title><h1>Fake gateway</h1><p data-amount>${s.amount} ${s.currency}</p><a href="${s.successUrl.replace(/"/g, '&quot;')}">Complete payment</a>`,
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'fake: no such route' } }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FAKE_STRIPE_PORT, '127.0.0.1', () => resolve({ server, sessions }));
  });
}
