'use strict';
// Every refusal gate of deploy.sh. A refusal exits 2 and must not have changed
// anything: no mutating command ran and the checkout is where it was.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeSandbox, standardChange, MUTATING } = require('./helpers');

function noMutation(sb) {
  const bad = sb.calls().filter((c) => MUTATING.some((re) => re.test(c)));
  assert.deepEqual(bad, [], 'mutating commands ran');
}
function withSb(fn, opts) {
  const sb = makeSandbox(opts);
  try { return fn(sb); } finally { sb.cleanup(); }
}

test('gate: dirty tracked file is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.appendFileSync(path.join(sb.prod, 'backend/src/a.txt'), 'hotfix\n');
  sb.marker(pin);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not clean/);
  assert.match(r.out, /DEPLOY_RESULT=REFUSED/);
  noMutation(sb);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('gate: untracked file (merchant upload) is refused too', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.mkdirSync(path.join(sb.prod, 'backend/uploads'), { recursive: true });
  fs.writeFileSync(path.join(sb.prod, 'backend/uploads/photo.jpg'), 'x');
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not clean/);
  assert.equal(sb.hasMarker(pin), false, 'a refused dry-run must not write a marker');
}));

test('gate: PIN not an ancestor of origin/main is refused', () => withSb((sb) => {
  const side = sb.sideCommit({ 'backend/src/a.txt': 'side\n' });
  // The commit exists locally (someone fetched a branch) but is not on main.
  sb.git('fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
  sb.marker(side);
  const r = sb.run('deploy.sh', [side, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of origin\/main/);
  noMutation(sb);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('gate: a commit the checkout has never heard of is refused', () => withSb((sb) => {
  const r = sb.run('deploy.sh', ['1'.repeat(40), '--dry-run']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not a commit/);
}));

test('gate: production HEAD not an ancestor of PIN is refused', () => withSb((sb) => {
  // A local-only commit on production (a hotfix nobody pushed) diverges from main.
  fs.writeFileSync(path.join(sb.prod, 'local.txt'), 'x');
  sb.git('add', '-A');
  sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'local hotfix');
  const local = sb.git('rev-parse', 'HEAD');
  const pin = standardChange(sb);
  sb.marker(pin);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of PIN/);
  noMutation(sb);
  assert.equal(sb.git('rev-parse', 'HEAD'), local);
}));

test('gate: PIN older than production (a rollback target) is refused', () => withSb((sb) => {
  const newer = standardChange(sb);
  sb.git('pull', '-q', '--ff-only');
  sb.marker(sb.base);
  const r = sb.run('deploy.sh', [sb.base, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of PIN/);
  assert.equal(sb.git('rev-parse', 'HEAD'), newer);
}));

test('gate: PIN equal to production is "already deployed", exit 0, nothing runs', () => withSb((sb) => {
  const r = sb.run('deploy.sh', [sb.base, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ALREADY DEPLOYED/);
  noMutation(sb);
}));

test('gate: checkout not on main is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.git('checkout', '-q', '-b', 'scratch');
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not main/);
}));

test('gate: a real run without --ci-verified is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin);
  const r = sb.run('deploy.sh', [pin]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /CI gate not verified/);
  noMutation(sb);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('gate: a dry-run without --ci-verified continues and says a real run would refuse', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /CI gate: NOT VERIFIED here \(a real run would refuse\)/);
  assert.match(r.out, /DRYRUN OK/);
}));

test('gate: no GitHub token is read or required anywhere (no token file, no API call)', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified'], { GITHUB_TOKEN: 'ghp_FAKEFAKEFAKE', GITHUB_TOKEN_FILE: '/nonexistent' });
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.calls().filter((c) => /api\.github\.com|^curl .*github/.test(c)).length, 0);
  const src = fs.readFileSync(path.join(__dirname, '..', 'deploy.sh'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'lib/common.sh'), 'utf8');
  assert.doesNotMatch(src, /GITHUB_TOKEN|api\.github\.com/);
}));

test('gate: real run without a dry-run marker is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /no dry-run marker/);
  noMutation(sb);
}));

test('gate: a stale (older than 24h) marker is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin, 86400 + 60);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /stale/);
  noMutation(sb);
}));

test('gate: a marker from the future is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin, -3600);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
}));

test('gate: a marker just inside 24h is accepted', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin, 86400 - 120);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
}));

test('gate: a marker for a DIFFERENT pin does not authorise this pin', () => withSb((sb) => {
  const first = standardChange(sb);
  const second = sb.commit({ 'backend/src/a.txt': 'again\n' });
  sb.marker(first);
  const r = sb.run('deploy.sh', [second, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /no dry-run marker/);
  noMutation(sb);
}));

test('gate: a malformed marker is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.mkdirSync(sb.logs, { recursive: true });
  fs.writeFileSync(path.join(sb.logs, `dryrun-ok-${pin}`), 'yesterday-ish\n');
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /malformed/);
}));

test('gate: a symlinked marker is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.mkdirSync(sb.logs, { recursive: true });
  const real = path.join(sb.root, 'elsewhere');
  fs.writeFileSync(real, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + '\n');
  fs.symlinkSync(real, path.join(sb.logs, `dryrun-ok-${pin}`));
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 2, r.out);
}));

test('gate: the marker is consumed by a real run (one dry-run, one attempt)', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.hasMarker(pin), false);
}));

test('gate: running as the wrong user is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run'], { DEPLOY_USER_EXPECTED: 'someone-else' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /must run as 'someone-else'/);
}));

test('gate: a pm2 process that is not online is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run'], { FAKE_PM2_DOWN: 'requital-admin' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /requital-admin' is not online/);
}));

test('gate: too little free disk is refused', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run'], { MIN_FREE_KB: '999999999999' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /free disk/);
}));

test('gate: unreachable database stops the run before any change', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.writeFileSync(path.join(sb.prod, 'backend/.env'), 'JWT_SECRET=fake\n'); // no DATABASE_URL
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /DATABASE_URL not set/);
  noMutation(sb);
}));

test('gate: billing migration pending but the PIN has no flag-matrix script is refused', () => withSb((sb) => {
  const pin = standardChange(sb, { 'backend/prisma/migrations/20261124100000_billing_plt1_tables/migration.sql': '-- b\n' });
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /flag-matrix/);
}));

test('plan: a pending migration that sorts before the last applied one is flagged', () => withSb((sb) => {
  fs.writeFileSync(path.join(sb.fakeDir, 'applied-migrations'), '20260101000000_init\n20990601000000_later\n');
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /WARNING: pending migration 20990101000000_new_thing sorts before the last applied/);
}));

test('plan: only the apps whose files changed are rebuilt', () => withSb((sb) => {
  const pin = sb.commit({ 'storefront/x.txt': 'x\n' });
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.match(r.out, /apps to rebuild: backend=0 storefront=1 admin=0/);
  assert.match(r.out, /WOULD DO: step 10 storefront/);
  assert.doesNotMatch(r.out, /WOULD DO: step 9 backend/);
  assert.doesNotMatch(r.out, /WOULD DO: step 10 admin/);
}));

test('plan: env fingerprints are md5 prefixes, never contents', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.match(r.out, /backend\/\.env [0-9a-f]{8}\n/);
  assert.doesNotMatch(r.out, /fake-not-a-secret|fake%40pw|fakeuser/);
}));
