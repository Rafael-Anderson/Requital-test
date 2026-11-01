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

test('redact: MYSQL_PWD / PWD-style and *_PASS names', () => {
  for (const line of ['MYSQL_PWD=s3cretpw', 'DB_PASS=hunter22', 'DB_PASSWORD: hunter33', 'APP_PWD = hunter44', 'REDIS_PASS=hunter55']) {
    const out = redact(`${line}\n`);
    assert.match(out, /\*\*\*/, line);
    assert.doesNotMatch(out, /s3cretpw|hunter\d+/, line);
  }
});

test('redact: JSON-style values', () => {
  const out = redact('{"user":"bob","password":"p w 1","apiKey":"AKIA123","secret":"s3","token":"t0k","note":"fine"}\n');
  assert.doesNotMatch(out, /p w 1|AKIA123|"s3"|t0k/);
  assert.match(out, /"user":"bob"/);
});

test('redact: Authorization headers mask the whole credential, whatever the scheme', () => {
  for (const line of [
    'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: Bearer abc.def.ghi', 'authorization: Token tok_12345',
    'Proxy-Authorization: Basic Zm9vOmJhcg==', '"Authorization": "Bearer abc.def"', 'Authorization=Bearer xyz789',
  ]) {
    const out = redact(`${line}\n`);
    assert.doesNotMatch(out, /dXNlcjpwYXNzd29yZA|abc\.def|tok_12345|Zm9vOmJhcg|xyz789|Basic dX|Bearer abc/, line);
  }
});

test('redact: cookies', () => {
  assert.doesNotMatch(redact('Cookie: session=abc123; other=zzz\n'), /abc123|zzz/);
  assert.doesNotMatch(redact('Set-Cookie: sid=qq991; Path=/\n'), /qq991/);
});

test('redact: quoted values with spaces', () => {
  const out = redact('PASSWORD="two words here" and SECRET=\'single quoted pw\' tail\n');
  assert.doesNotMatch(out, /two words here|single quoted pw|words|quoted pw/);
  assert.match(out, / tail\n$/);
});

test('redact: a raw @ inside a URL password is masked up to the LAST @ before the host', () => {
  assert.equal(redact('mysql://u:p@ss@db.internal:3306/shop\n'), 'mysql://u:***@db.internal:3306/shop\n');
  assert.equal(redact('postgres://user:a@b@c@host/x?y=1\n'), 'postgres://user:***@host/x?y=1\n');
  assert.equal(redact('see http://example.com:8080/path?email=a@b ok\n'), 'see http://example.com:8080/path?email=a@b ok\n');
});

test('redact: a PEM private key is masked from the BEGIN line to the END line, body included', () => {
  const pem = ['before', '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU', 'AAAAB3NzaC1lZDI1NTE5AAAAIFAKEKEY', '-----END OPENSSH PRIVATE KEY-----', 'after'].join('\n') + '\n';
  const out = redact(pem);
  assert.doesNotMatch(out, /b3BlbnNzaC1|AAAAB3NzaC1lZDI1|FAKEKEY/);
  assert.match(out, /^before\n/);
  assert.match(out, /\nafter\n$/);
  assert.match(out, /REDACTED PRIVATE KEY/);
});

test('redact: a one-line PEM does not swallow the lines after it', () => {
  const out = redact('-----BEGIN RSA PRIVATE KEY-----MIIEAAAA-----END RSA PRIVATE KEY-----\nstill visible\n');
  assert.doesNotMatch(out, /MIIEAAAA/);
  assert.match(out, /still visible/);
});

test('redact: an unterminated PEM block masks the rest of the stream (fail closed)', () => {
  const out = redact('-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n');
  assert.doesNotMatch(out, /AAAA|BBBB/);
});

test('redact: ssh-entry.sh embeds a byte-identical copy of the sed program', () => {
  const fs = require('fs');
  const grab = (file) => fs.readFileSync(path.join(DEPLOY_DIR, file), 'utf8').match(/<<'REDACT_SED_EOF'\n([\s\S]*?)\nREDACT_SED_EOF\n/)[1];
  assert.equal(grab('ssh-entry.sh'), grab('lib/redact.sh'));
});
