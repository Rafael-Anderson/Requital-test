'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR } = require('./helpers');

function redact(input) {
  const r = cp.spawnSync('bash', ['-c', `. "${path.join(DEPLOY_DIR, 'lib/redact.sh')}"; redact`], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

test('redact: URL passwords are masked, the user and host stay', () => {
  assert.equal(redact('mysql://root:pa55word@db.internal:3306/shop\n'), 'mysql://root:***@db.internal:3306/shop\n');
  assert.equal(redact('postgres://u:p%40ss@h/db and https://a:b@c.example/x\n'), 'postgres://u:***@h/db and https://a:***@c.example/x\n');
});

test('redact: bearer tokens and Authorization headers', () => {
  const out = redact('Authorization: Bearer abc.def-123_xyz\ncurl -H "Bearer tok123"\n');
  assert.doesNotMatch(out, /abc\.def-123_xyz|tok123/);
});

test('redact: NAME=value for secret-looking names', () => {
  for (const line of [
    'JWT_SECRET=supersecretvalue', 'CSRF_SECRET: abcdef', 'RESEND_API_KEY=re_123456', 'CREDENTIAL_ENCRYPTION_KEY=0011223344',
    'DATABASE_PASSWORD=hunter2', 'password: hunter2', 'STRIPE_SECRET_KEY=sk_live_abc', 'PAYPAL_CLIENT_SECRET = abc',
    'GITHUB_TOKEN=ghp_abc123', 'x-auth: sometoken', 'TAMARA_NOTIFICATION_TOKEN=abc',
  ]) {
    const out = redact(`${line}\n`);
    assert.match(out, /\*\*\*/, line);
    assert.doesNotMatch(out, /supersecretvalue|abcdef|re_123456|0011223344|hunter2|sk_live_abc|ghp_abc123|sometoken|=\s*abc$/, line);
  }
});

test('redact: PEM private key lines', () => {
  const out = redact('-----BEGIN OPENSSH PRIVATE KEY-----AAAAB3NzaC1\n');
  assert.doesNotMatch(out, /AAAAB3Nza/);
});

test('redact: leaves SHAs and result lines untouched', () => {
  const text = `PREVIOUS_SHA=${SHA}\nNEW_SHA=${SHA}\nDEPLOY_RESULT=OK\nBACKUP_FILE=/home/deploy/backups/x.sql.gz\nLOG_FILE=/a/b.log\nDEPLOY_RESULT=FAILED step=9\n`;
  assert.equal(redact(text), text);
});

test('redact: leaves ordinary progress lines alone', () => {
  const text = 'pm2: requital-backend online uptime=100s restarts=0\nenv fingerprints (md5, 8 hex) BEFORE:\n  backend/.env 381b66b8\nbackend: HTTP 200\n';
  assert.equal(redact(text), text);
});

test('redact: is line-streaming (works on long multi-line input)', () => {
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i} mysql://u${i}:pw${i}@h/db`).join('\n') + '\n';
  const out = redact(lines);
  assert.doesNotMatch(out, /pw\d+@/);
  assert.equal(out.split('\n').length, 501);
});
