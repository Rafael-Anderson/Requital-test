import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../../src/database/database.service';

export interface SentEmail {
  to: string;
  subject: string;
  bodyText: string;
}

// Every send_email job the shop has queued for an address, oldest first. The
// queue is what a real send is made from, so this is "what would have been
// mailed to whom".
export async function sentEmails(
  db: DatabaseService,
  shopId: number,
  to: string,
): Promise<SentEmail[]> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT payload FROM job WHERE shopId = ? AND type = 'send_email' ORDER BY id ASC`,
    [shopId],
  );
  return rows
    .map((r) => r.payload as SentEmail)
    .filter((p) => p.to.toLowerCase() === to.toLowerCase());
}

export function tokenIn(mail: SentEmail): string {
  const m = /token=([0-9a-f]+)/.exec(mail.bodyText);
  if (!m) throw new Error('no token in email');
  return m[1];
}

// Clicks the newest verification link mailed to `email`.
export async function verifyCustomerEmail(
  server: App,
  db: DatabaseService,
  shop: { slug: string; id: number },
  email: string,
): Promise<void> {
  const mails = (await sentEmails(db, shop.id, email)).filter(
    (m) => m.subject === 'Verify your email',
  );
  const mail = mails[mails.length - 1];
  await request(server)
    .post(`/public/${shop.slug}/auth/verify-email`)
    .send({ token: tokenIn(mail) })
    .expect(201);
}
