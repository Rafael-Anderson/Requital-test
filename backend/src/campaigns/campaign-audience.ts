import type { CompiledPredicate } from '../customer-segments/segment-rules';

// MKT-1. THE one definition of who may receive a campaign. Everything that sends,
// counts or re-checks an address goes through audienceSql, so the consent rule
// cannot exist in two places and drift.
//
// An address is in the audience only when ALL of these hold:
//   (A) a customer of the shop has a customerconsent row for channel 'email' with
//       status 'granted' (no row = UNKNOWN = out), and a non-empty email, AND the
//       grant is either admin-recorded (the merchant attests how it was obtained) or
//       the account's email is VERIFIED. A self-service grant on an unverified
//       account proves nothing about who owns the address (anyone can register with
//       a stranger's email and tick the box), so it is excluded; any other or
//       future source is treated the same way; OR
//   (B) a newsletter subscriber of the shop has a confirmedAt (double opt-in). An
//       old, unconfirmed row never qualifies. A segment narrows (B) too: such an
//       address is kept only if a customer with that email matches the segment;
// AND
//   - no customer of the shop with that email has WITHDRAWN email consent (an
//     explicit "no" beats a newsletter row, whichever customer row holds it);
//   - the address is not in emailsuppression for the shop;
//   - it is not an anonymised placeholder and looks like one plain address.
//
// A segment is AND-ed onto (A) and (B) only. It can narrow the audience, never
// widen it: the consent predicates are not inside the segment's reach.
//
// All tables here are utf8mb4_unicode_ci, so `=` and GROUP BY are case-insensitive
// and one address held by two rows is one recipient.
const PLAIN_EMAIL =
  '^[^[:space:]@<>,;"\\\\]+@[^[:space:]@<>,;"\\\\]+[.][^[:space:]@<>,;"\\\\]+$';

export function audienceSql(
  shopId: number,
  segment: CompiledPredicate | null,
  onlyEmail?: string,
): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [];

  let a = `SELECT c.email AS email FROM customer c
      WHERE c.shopId = ? AND c.email IS NOT NULL AND c.email <> ''
        AND EXISTS (SELECT 1 FROM customerconsent cc
                     WHERE cc.customerId = c.id AND cc.shopId = c.shopId
                       AND cc.channel = 'email' AND cc.status = 'granted'
                       AND (cc.source = 'admin'
                            OR (c.verifiedEmail IS NOT NULL AND c.verifiedEmail = c.email)))`;
  params.push(shopId);
  if (segment) {
    a += ` AND ${segment.sql}`;
    params.push(...segment.params);
  }

  let b = `SELECT n.email AS email FROM newslettersubscriber n
      WHERE n.shopId = ? AND n.confirmedAt IS NOT NULL`;
  params.push(shopId);
  if (segment) {
    b += ` AND EXISTS (SELECT 1 FROM customer c
                        WHERE c.shopId = n.shopId AND c.email = n.email AND ${segment.sql})`;
    params.push(...segment.params);
  }

  let sql = `SELECT MIN(u.email) AS email FROM (${a} UNION ALL ${b}) u
    WHERE u.email NOT LIKE '%@deleted.requital'
      AND u.email REGEXP ?
      AND NOT EXISTS (SELECT 1 FROM customer w
                       JOIN customerconsent wc ON wc.customerId = w.id AND wc.shopId = w.shopId
                      WHERE w.shopId = ? AND w.email = u.email
                        AND wc.channel = 'email' AND wc.status = 'withdrawn')
      AND NOT EXISTS (SELECT 1 FROM emailsuppression s WHERE s.shopId = ? AND s.email = u.email)`;
  params.push(PLAIN_EMAIL, shopId, shopId);
  if (onlyEmail !== undefined) {
    sql += ` AND u.email = ?`;
    params.push(onlyEmail);
  }
  sql += ` GROUP BY u.email`;
  return { sql, params };
}
