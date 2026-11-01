'use strict';
// Real (non dry-run) deploy against the fakes: ordering, every STOP condition,
// secrecy of the log, self-protection against the merge replacing deploy.sh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSandbox, standardChange, hugeChange, git } = require('./helpers');

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
  assert.match(r.out, /ROW CHECK FAILED order/);
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

test('a restore drill whose _migrations table differs from the live one fails', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_DRILL_MIGRATIONS: '20260101000000_init\n20200101000000_extra' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /_migrations differ/);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
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

// ---- HIGH-1: a huge changed-file list must not make an app look "unchanged" ----------
test('a changed-file list far above the pipe buffer still rebuilds and restarts every changed app', () => withSb((sb) => {
  const pin = hugeChange(sb, 3000, { 'admin/y.txt': 'y\n', 'storefront/x.txt': 'x\n' });
  const listSize = sb.seedGit('diff', '--name-only', sb.base, pin).length;
  assert.ok(listSize > 150000, `list is only ${listSize} bytes`);
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /files changed PROD\.\.PIN: 3002/);
  assert.match(r.out, /apps to rebuild: backend=1 storefront=1 admin=1/);
  const c = sb.calls();
  for (const app of ['backend', 'storefront', 'admin']) assert.ok(c.includes(`npm[${app}] run build`), `${app} was not rebuilt`);
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend', 'pm2 restart requital-storefront', 'pm2 restart requital-admin']);
}));

test('the same holds in a dry-run plan (admin is the FIRST path in the list)', () => withSb((sb) => {
  const pin = hugeChange(sb, 3000, { 'admin/y.txt': 'y\n' });
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /apps to rebuild: backend=1 storefront=0 admin=1/);
}));

test('paths with non-ASCII characters are still attributed to their app (core.quotepath off)', () => withSb((sb) => {
  const pin = sb.commit({ 'admin/caf\u00e9-\u30c6\u30b9\u30c8.txt': 'x\n' });
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
  assert.match(r.out, /apps to rebuild: backend=0 storefront=0 admin=1/);
}));

// ---- the tolerant row-level gate ---------------------------------------------------------
function rows(sb, table, phase, text) {
  fs.mkdirSync(path.join(sb.fakeDir, 'rows'), { recursive: true });
  fs.writeFileSync(path.join(sb.fakeDir, 'rows', `${table}.${phase}`), text);
}

test('a normal order edit during the window does NOT stop the deploy (and is counted)', () => withSb((sb) => {
  const pin = standardChange(sb);
  // order 1 was edited by the shop: money columns changed, its items were replaced
  // (row 1 gone, replaced by an id above the captured max), a shop row's updatedAt moved.
  rows(sb, 'ordermoney', 'before', '1\tm1\n2\tm2\n');
  rows(sb, 'ordermoney', 'after', '1\tm1-edited\n2\tm2\n');
  rows(sb, 'orderitem', 'before', '1\ti1\t1\n2\ti2\t2\n');
  rows(sb, 'orderitem', 'after', '2\ti2\t2\n101\tnew\t1\n');
  rows(sb, 'shop', 'before', '1\tshop1\tU1\n');
  rows(sb, 'shop', 'after', '1\tshop1-changed\tU9\n');
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /orders edited during the window \(money columns changed\): 1/);
  assert.match(r.out, /rows orderitem: checked=2 changed=1 tolerated=1 fatal=0/);
  assert.match(r.out, /rows shop: checked=1 changed=1 tolerated=1 fatal=0/);
  assert.match(r.out, /tolerated \(normal application edits during the window\): 2 row\(s\)/);
  assert.equal(restarts(sb).length, 3);
}));

test('a changed orderitem row of an order that was NOT edited stops before any restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  rows(sb, 'orderitem', 'before', '1\ti1\t1\n2\ti2\t2\n');
  rows(sb, 'orderitem', 'after', '1\ti1-DAMAGED\t1\n2\ti2\t2\n');
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ROW CHECK FAILED orderitem/);
  assert.match(r.out, /fatal ids \(first 5\): 1/);
  assert.match(r.out, /DEPLOY_RESULT=FAILED step=9/);
  assert.equal(restarts(sb).length, 0);
}));

test('a changed row whose updatedAt did not move (simulated migration damage) stops before any restart', () => withSb((sb) => {
  const pin = standardChange(sb);
  rows(sb, 'shop', 'before', '1\tshop1\tU1\n');
  rows(sb, 'shop', 'after', '1\tshop1-DAMAGED\tU1\n');
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ROW CHECK FAILED shop/);
  assert.equal(restarts(sb).length, 0);
}));

test('a table without updatedAt is judged on immutable columns only: a vanished stockmovement row is fatal', () => withSb((sb) => {
  const pin = standardChange(sb);
  rows(sb, 'stockmovement', 'before', '1\ts1\n2\ts2\n');
  rows(sb, 'stockmovement', 'after', '2\ts2\n');
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ROW CHECK FAILED stockmovement/);
  assert.equal(restarts(sb).length, 0);
}));

test('the per-row SQL: bounded by the captured max id, explicit columns, never GROUP_CONCAT, no PDPL-scrubbable phone', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  const rowQueries = sb.calls().filter((c) => /MD5\(CONCAT_WS/.test(c) && !/BIT_XOR/.test(c));
  assert.ok(rowQueries.length >= 18, `only ${rowQueries.length} per-row queries (9 tables x before/after)`);
  for (const q of rowQueries) {
    assert.match(q, /WHERE `id` <= 100 ORDER BY `id`/);
    assert.doesNotMatch(q, /GROUP_CONCAT/);
  }
  const customer = rowQueries.find((q) => /FROM `customer`/.test(q));
  assert.doesNotMatch(customer, /`phone`/);
  const shop = rowQueries.find((q) => /FROM `shop`/.test(q));
  assert.match(shop, /CAST\(`updatedAt` AS CHAR\)/);
}));

// ---- the lock must not be inherited by children ---------------------------------------
test('a lingering child of the build does not keep the deploy lock held after the deploy exits', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_LINGER: '1' });
  try {
    assert.equal(r.status, 0, r.out);
    const pidFile = path.join(sb.fakeDir, 'linger-pid');
    assert.ok(fs.existsSync(pidFile), 'the fake did not start a lingering child');
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    process.kill(pid, 0); // still alive
    const probe = cp.spawnSync('flock', ['-n', sb.env.LOCK_FILE, 'true']);
    assert.equal(probe.status, 0, 'the lock is still held by a lingering child');
  } finally {
    try { process.kill(Number(fs.readFileSync(path.join(sb.fakeDir, 'linger-pid'), 'utf8'))); } catch { /* already gone */ }
  }
}));

// ---- temp files are removed on every exit path --------------------------------------------
test('no temporary files are left behind: success, failure, refusal, dry-run, lock-out', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']).status, 0);
  assert.deepEqual(sb.tmpLeftovers(), [], 'dry-run');
  const pin2 = sb.commit({ 'backend/src/a.txt': 'again\n' });
  assert.equal(sb.run('deploy.sh', [pin2, '--ci-verified']).status, 2);
  assert.deepEqual(sb.tmpLeftovers(), [], 'refusal');
  sb.marker(pin2);
  assert.equal(sb.run('deploy.sh', [pin2, '--ci-verified'], { FAKE_MIGRATE_FAIL: '1' }).status, 1);
  assert.deepEqual(sb.tmpLeftovers(), [], 'failure');
}));

test('no temporary files are left behind after a clean success', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  assert.deepEqual(sb.tmpLeftovers(), []);
}));

// ---- deployed-shas -----------------------------------------------------------------------
test('a successful deploy records the previous sha (first time) and the new sha; a failed one records nothing', () => withSb((sb) => {
  const failing = standardChange(sb);
  assert.equal(real(sb, failing, { FAKE_MIGRATE_FAIL: '1' }).status, 1);
  assert.equal(fs.existsSync(path.join(sb.logs, 'deployed-shas')), false, 'a failed run must not record');
  // roll the checkout back by hand and deploy for real
  sb.git('reset', '-q', '--hard', sb.base);
  assert.equal(real(sb, failing).status, 0);
  const lines = fs.readFileSync(path.join(sb.logs, 'deployed-shas'), 'utf8').trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(' ')[0]), [sb.base, failing]);
  assert.match(lines[0], /^[0-9a-f]{40} \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ previous$/);
  assert.match(lines[1], / deploy$/);
  assert.equal(fs.statSync(path.join(sb.logs, 'deployed-shas')).mode & 0o777, 0o600);
  // a second deploy appends only the new sha (the previous one is already recorded)
  const next = sb.commit({ 'backend/src/a.txt': 'next\n' });
  assert.equal(real(sb, next).status, 0);
  const again = fs.readFileSync(path.join(sb.logs, 'deployed-shas'), 'utf8').trim().split('\n').map((l) => l.split(' ')[0]);
  assert.deepEqual(again, [sb.base, failing, next]);
}));

// ---- DATABASE_URL parsing ---------------------------------------------------------------------
test('DATABASE_URL: + stays +, percent escapes decode, backslashes survive, query string with / is ignored', () => withSb((sb) => {
  fs.writeFileSync(path.join(sb.prod, 'backend/.env'), 'DATABASE_URL=mysql://app%40user:p+a%40b%5Cn%25@127.0.0.1:3307/appdb?ssl=true&path=a/b/c\n');
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.readFileSync(path.join(sb.fakeDir, 'pwd-seen'), 'utf8'), 'p+a@b\\n%\n');
  const args = fs.readFileSync(path.join(sb.fakeDir, 'args-seen'), 'utf8');
  assert.match(args, /--user=app@user/);
  assert.match(args, /--port=3307/);
  assert.match(args, /--host=127\.0\.0\.1/);
  assert.ok(sb.calls().some((c) => c.startsWith('mysql[appdb] ')), 'database name must be appdb');
}));

test('DATABASE_URL: a raw @ inside the password stays in the password', () => withSb((sb) => {
  fs.writeFileSync(path.join(sb.prod, 'backend/.env'), 'DATABASE_URL="mysql://u:pa@ss@dbhost:3306/shop"\n');
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.readFileSync(path.join(sb.fakeDir, 'pwd-seen'), 'utf8'), 'pa@ss\n');
  assert.match(fs.readFileSync(path.join(sb.fakeDir, 'args-seen'), 'utf8'), /--host=dbhost/);
}));

// ---- health checks and smoke slug -----------------------------------------------------------------
test('storefront and admin must answer 200-399: a 404 or 500 fails, a 307 passes', () => withSb((sb) => {
  const pin = standardChange(sb);
  for (const [env, code, ok] of [['FAKE_STOREFRONT_CODE', '404', false], ['FAKE_STOREFRONT_CODE', '500', false], ['FAKE_ADMIN_CODE', '404', false], ['FAKE_STOREFRONT_CODE', '307', true]]) {
    sb.git('reset', '-q', '--hard', sb.base);
    const r = real(sb, pin, { [env]: code });
    assert.equal(r.status, ok ? 0 : 1, `${env}=${code}: ${r.out}`);
    if (!ok) assert.match(r.out, /health check failed/);
  }
}));

test('the post-restart stability wait defaults to at least 15 seconds', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib/common.sh'), 'utf8');
  const m = src.match(/STABLE_WAIT="\$\{STABLE_WAIT:-(\d+)\}"/);
  assert.ok(m && Number(m[1]) >= 15);
});

test('no smoke shop: the failure says how to override SMOKE_SHOP_SLUG', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified'], { FAKE_SLUG: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /SMOKE_SHOP_SLUG=<subdomain of a live, published shop>/);
  assert.match(r.out, /deleted|suspended/);
}));

// ---- permissions ------------------------------------------------------------------------------------
test('merged files keep the normal 022 mask; the log, marker and deployed-shas are private (077)', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  assert.equal(fs.statSync(path.join(sb.prod, 'admin/y.txt')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(sb.logs, sb.logFiles()[0])).mode & 0o777, 0o600);
}));

test('ts-node for the flag matrix is run with npx --no-install (never fetches from the network)', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  assert.equal(real(sb, pin).status, 0);
  assert.ok(sb.calls().some((c) => /^npx --no-install ts-node/.test(c)));
}, { matrix: true }));

// ---- PDPL anonymisation must not stop a deploy --------------------------------------------------
function data(sb, table, phase, rowsArray) {
  fs.mkdirSync(path.join(sb.fakeDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(sb.fakeDir, 'data', `${table}.${phase}.json`), JSON.stringify(rowsArray));
}

test('a customer anonymised during the window (phone scrubbed) does NOT stop the deploy', () => withSb((sb) => {
  const pin = standardChange(sb);
  data(sb, 'customer', 'before', [
    { id: 1, shopId: 1, createdAt: '2026-01-01 10:00:00', phone: '+971500000001' },
    { id: 2, shopId: 1, createdAt: '2026-01-02 10:00:00', phone: '+971500000002' },
  ]);
  data(sb, 'customer', 'after', [
    { id: 1, shopId: 1, createdAt: '2026-01-01 10:00:00', phone: 'deleted-1' }, // PDPL anonymisation
    { id: 2, shopId: 1, createdAt: '2026-01-02 10:00:00', phone: '+971500000002' },
  ]);
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /rows customer: checked=2 changed=0 tolerated=0 fatal=0/);
}));

test('a customer whose shopId or createdAt changed (not an anonymisation) DOES stop the deploy', () => withSb((sb) => {
  const pin = standardChange(sb);
  data(sb, 'customer', 'before', [{ id: 1, shopId: 1, createdAt: '2026-01-01 10:00:00', phone: '+971500000001' }]);
  data(sb, 'customer', 'after', [{ id: 1, shopId: 2, createdAt: '2026-01-01 10:00:00', phone: '+971500000001' }]);
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ROW CHECK FAILED customer/);
  assert.equal(restarts(sb).length, 0);
}));
