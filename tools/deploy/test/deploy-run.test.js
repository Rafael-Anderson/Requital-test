'use strict';
// Real (non dry-run) deploy against the fakes: ordering, every STOP condition,
// secrecy of the log, self-protection against the merge replacing deploy.sh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSandbox, standardChange, git } = require('./helpers');

function real(sb, pin, env = {}, extra = []) {
  sb.marker(pin);
  return sb.run('deploy.sh', [pin, '--ci-verified', ...extra], env);
}
const idx = (calls, re) => calls.findIndex((c) => re.test(c));
const restarts = (sb) => sb.calls().filter((c) => /^pm2 restart/.test(c));
function withSb(fn, opts) {
  const sb = makeSandbox(opts);
  try { return fn(sb); } finally { sb.cleanup(); }
}

test('happy path: order of operations and the final report', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  const lines = r.out.trim().split('\n');
  assert.equal(lines[lines.length - 1], 'DEPLOY_RESULT=OK');
  assert.match(r.out, new RegExp(`PREVIOUS_SHA=${sb.base}`));
  assert.match(r.out, new RegExp(`NEW_SHA=${pin}`));
  assert.match(r.out, /BACKUP_FILE=.*\.sql\.gz/);
  assert.equal(sb.git('rev-parse', 'HEAD'), pin);

  const c = sb.calls();
  const backup = idx(c, /^backup-db\.sh/);
  const restore = idx(c, /^restore-db\.sh/);
  const migrate = idx(c, /db:migrate/);
  const lastBuild = Math.max(...c.map((x, i) => (/^npm\[.*\] run build/.test(x) ? i : -1)));
  const firstRestart = idx(c, /^pm2 restart/);
  assert.ok(backup >= 0 && restore > backup, 'backup then restore drill');
  assert.ok(migrate > restore, 'migrate only after the drill');
  assert.ok(firstRestart > lastBuild, 'every build finishes before the first restart');
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend', 'pm2 restart requital-storefront', 'pm2 restart requital-admin']);
  assert.ok(idx(c, /npm\[storefront\] run build/) > migrate);
  // gzip -t and the health checks happened
  assert.ok(idx(c, /\/health\/ready/) >= 0);
  assert.ok(idx(c, /redirects\/map/) >= 0);
}));

test('the migration runs against the backup-verified DB only after BEFORE checksums were taken', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  const c = sb.calls();
  const firstChecksum = idx(c, /BIT_XOR/);
  const migrate = idx(c, /db:migrate/);
  const lastChecksum = Math.max(...c.map((x, i) => (/BIT_XOR/.test(x) ? i : -1)));
  assert.ok(firstChecksum >= 0 && firstChecksum < migrate && lastChecksum > migrate);
  for (const q of c.filter((x) => /BIT_XOR/.test(x))) {
    assert.doesNotMatch(q, /GROUP_CONCAT/);
  }
  assert.ok(c.some((x) => /BIT_XOR.*`order` WHERE `id` <= 100/.test(x)), 'order checksum is bounded by the captured max id');
}));

test('storefront is built with INTERNAL_API_URL pointing at the local backend', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  const m = JSON.parse(fs.readFileSync(path.join(sb.prod, 'storefront/.next/routes-manifest.json'), 'utf8'));
  assert.equal(m.rewrites.afterFiles[0].destination, 'http://127.0.0.1:3000/:path*');
}));

test('a storefront build without the baked-in rewrite stops before any restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_BAD_REWRITE: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=10/);
  assert.equal(restarts(sb).length, 0);
}));

test('only the changed app is rebuilt and restarted', () => withSb((sb) => {
  const pin = sb.commit({ 'admin/y.txt': 'y\n' });
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.calls().filter((c) => /^npm\[(backend|storefront)\]/.test(c)).length, 0);
  assert.deepEqual(restarts(sb), ['pm2 restart requital-admin']);
}));

test('a checksum mismatch after the migrations STOPS before any restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_MIGRATE_MUTATES: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /CHECKSUM MISMATCH/);
  assert.match(r.out, /NO process was restarted/);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=9/);
  assert.match(r.out, /mode=rollback/);
  assert.equal(restarts(sb).length, 0);
  assert.equal(sb.calls().filter((c) => /^npm\[(storefront|admin)\]/.test(c)).length, 0, 'later builds must not start');
}));

test('a failing migration stops the run, no restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_MIGRATE_FAIL: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=9/);
  assert.equal(restarts(sb).length, 0);
}));

test('backend dist/main.js missing triggers one wipe-and-rebuild, then succeeds', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_NO_DIST: 'first' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /wiping dist and rebuilding once/);
}));

test('backend dist/main.js still missing after the rebuild fails before any restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_NO_DIST: 'always' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /still missing/);
  assert.equal(restarts(sb).length, 0);
}));

test('a corrupt backup fails at step 6 before the checkout moves', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_BACKUP_CORRUPT: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=6/);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base, 'no merge before the backup is proven');
  assert.equal(sb.calls().filter((c) => /^npm\[/.test(c)).length, 0);
}));

test('a restore drill whose counts break before <= restored <= after fails at step 6', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_DRILL_COUNTS: '1\t99\t20\t5\t60' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /before <= restored <= after/);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('a restore drill with fewer rows than the live DB had before fails', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_DRILL_COUNTS: '1\t3\t20\t5\t60' });
  assert.equal(r.status, 1, r.out);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('a restore drill with a different table count fails', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_DRILL_COUNTS: '1\t10\t20\t5\t59' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /table count differs/);
}));

test('the scratch database is dropped before and after the drill', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  const drops = sb.calls().filter((c) => /DROP DATABASE IF EXISTS `fake_db_drill`/.test(c));
  assert.equal(drops.length, 2);
  assert.equal(sb.calls().filter((c) => /DROP DATABASE.*`fake_db`/.test(c)).length, 0, 'never drops the live DB');
}));

test('a failing backend health check stops the run at the backend', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_HEALTH: '503' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=11/);
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend']);
}));

test('a crash-looping process (restart counter climbing) is detected', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_CRASHLOOP: 'requital-backend' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /crash-looping/);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=11/);
}));

test('a process that goes errored after restart fails the deploy', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_PM2_FAIL: 'requital-storefront' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /did not come online/);
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend', 'pm2 restart requital-storefront']);
}));

test('a fresh "Cannot find module" in the logs after restart is fatal', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_CANNOT_FIND: 'requital-backend' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Cannot find module/);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=12/);
}));

test('a STALE "Cannot find module" already in the logs before the restart is not fatal', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_STALE_CNF: '1' });
  assert.equal(r.status, 0, r.out);
}));

test('redirect-map smoke without an ETag fails', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_NO_ETAG: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no ETag/);
}));

test('a changed .env fingerprint during the deploy fails step 13', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_TOUCH_ENV: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=13/);
}));

test('secrets in command output are redacted in stdout AND in the log file', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_LEAK: '1' });
  assert.equal(r.status, 0, r.out);
  const log = fs.readFileSync(path.join(sb.logs, sb.logFiles()[0]), 'utf8');
  for (const text of [r.out, log]) {
    assert.doesNotMatch(text, /topsecretpw|hunter2pass|abcdef0123456789abcdef/);
    assert.match(text, /mysql:\/\/admin:\*\*\*@10\.0\.0\.1/);
  }
  // the env files themselves are never echoed
  assert.doesNotMatch(log, /fake%40pw|fake-not-a-secret|must-not-be-printed|fakeuser/);
  // and the DB password never appears in any recorded argv
  assert.ok(!sb.calls().some((c) => /fake@pw|fake%40pw/.test(c)));
}));

test('the log file is mode 600', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  const f = path.join(sb.logs, sb.logFiles()[0]);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
}));

test('self-protection: the merge may replace deploy.sh itself and the run still completes', () => withSb((sb) => {
  const pin = sb.commit({
    'tools/deploy/deploy.sh': '#!/usr/bin/env bash\necho "THE NEW SCRIPT MUST NOT RUN MID-DEPLOY"; exit 77\n',
    'backend/src/a.txt': 'new\n',
  });
  sb.marker(pin);
  const r = cp.spawnSync('bash', [path.join(sb.prod, 'tools/deploy/deploy.sh'), pin, '--ci-verified'], {
    env: sb.env, encoding: 'utf8', timeout: 60000,
  });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /DEPLOY_RESULT=OK/);
  assert.doesNotMatch(out, /THE NEW SCRIPT/);
  assert.match(fs.readFileSync(path.join(sb.prod, 'tools/deploy/deploy.sh'), 'utf8'), /THE NEW SCRIPT/);
}));

// ---- billing flag matrix -----------------------------------------------------------
const BILLING = { 'backend/prisma/migrations/20261124100000_billing_plt1_tables/migration.sql': '-- b\n' };

test('billing flag matrix: run before and after from an untracked temp copy that is removed', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.calls().filter((c) => /^npx /.test(c)).length, 2);
  assert.match(r.out, /billing flag matrix: identical before\/after/);
  assert.equal(sb.git('status', '--porcelain'), '', 'temp matrix script must be gone');
}, { matrix: true }));

test('billing flag matrix: a difference after the migrations stops before restart', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  const r = real(sb, pin, { FAKE_MATRIX_MUTATES: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /flag matrix differs/);
  assert.equal(restarts(sb).length, 0);
  assert.equal(sb.git('status', '--porcelain'), '');
}, { matrix: true }));

test('the order checksum inside the flag matrix is informational (orders keep arriving)', () => withSb((sb) => {
  // the fake prints a random order count each call; the run must still pass
  const pin = standardChange(sb, BILLING);
  assert.equal(real(sb, pin).status, 0);
}, { matrix: true }));
