#!/usr/bin/env node
// A5: READ-ONLY report of card-processor (Nomod, Stripe) credentials.
//
//   1. Stored credentials that would FAIL the save-time shape checks
//      (backend/src/payments/credential-validation.ts).
//   2. Every Nomod/Stripe row's rejected-status columns (credentialStatus,
//      credentialStatusAt, credentialAlertedAt; migration 20261205100000).
//
// Prints ONLY: shop id, shop name, provider, field name and those status
// columns. Never a credential value, never the database URL. It opens one
// connection, marks the session READ ONLY and runs SELECTs: it writes nothing.
//
// Needs a built backend (backend/dist) for the decrypt and validation helpers,
// and reads DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY from backend/.env.
// Usage (VPS, as the app user): see docs/runbook.md, "A5 credential report".
'use strict';
const path = require('path');
const { createRequire } = require('module');

const backendDir = path.resolve(__dirname, '..', '..', 'backend');
const req = createRequire(path.join(backendDir, 'package.json'));
req('dotenv').config({ path: path.join(backendDir, '.env'), quiet: true });
const mysql = req('mysql2/promise');
const { decrypt } = req(path.join(backendDir, 'dist', 'common', 'crypto'));
const { credentialProblems } = req(
  path.join(backendDir, 'dist', 'payments', 'credential-validation'),
);

const iso = (d) => (d ? new Date(d).toISOString() : 'NULL');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in backend/.env');
  }
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const [rows] = await conn.query(
      `SELECT p.shopId, s.name, p.provider, p.credentials,
              p.credentialStatus, p.credentialStatusAt, p.credentialAlertedAt
         FROM shoppaymentprovider p JOIN shop s ON s.id = p.shopId
        WHERE p.provider IN ('nomod', 'stripe')
        ORDER BY p.shopId, p.provider`,
    );

    console.log('-- stored credentials that would FAIL the save-time checks --');
    let bad = 0;
    for (const r of rows) {
      if (!r.credentials) continue;
      let creds;
      try {
        creds = JSON.parse(decrypt(r.credentials));
      } catch {
        bad++;
        console.log(`shop ${r.shopId} (${r.name}) ${r.provider}: could not decrypt`);
        continue;
      }
      for (const field of Object.keys(credentialProblems(r.provider, creds))) {
        bad++;
        console.log(`shop ${r.shopId} (${r.name}) ${r.provider}: field ${field}`);
      }
    }
    if (!bad) console.log('(none)');

    console.log('-- rejected-status columns (credentialStatus / credentialStatusAt / credentialAlertedAt) --');
    for (const r of rows) {
      console.log(
        `shop ${r.shopId} (${r.name}) ${r.provider}: ${r.credentialStatus ?? 'NULL'} / ${iso(r.credentialStatusAt)} / ${iso(r.credentialAlertedAt)}`,
      );
    }
    if (!rows.length) console.log('(no Nomod or Stripe rows)');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  // The error CODE only: a driver message could echo connection details.
  console.error('report failed:', (e && (e.code || e.name)) || 'error');
  process.exit(1);
});
