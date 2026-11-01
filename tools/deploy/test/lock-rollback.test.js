'use strict';
// The flock lock, and rollback.sh (code only, guarded).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSandbox, standardChange } = require('./helpers');

function withSb(fn, opts) {
  const sb = makeSandbox(opts);
  try { return fn(sb); } finally { sb.cleanup(); }
}
const restarts = (sb) => sb.calls().filter((c) => /^pm2 restart/.test(c));

function holdLock(sb) {
  fs.mkdirSync(path.dirname(sb.env.LOCK_FILE), { recursive: true });
  const holder = cp.spawn('flock', ['-n', sb.env.LOCK_FILE, 'sleep', '30'], { stdio: 'ignore' });
  // wait until the lock is really held
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const probe = cp.spawnSync('flock', ['-n', sb.env.LOCK_FILE, 'true']);
    if (probe.status !== 0) break;
    cp.spawnSync('sleep', ['0.1']);
  }
  return holder;
}

test('lock: a second deploy while one is running exits 3 and changes nothing', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin);
  const holder = holdLock(sb);
  try {
    const r = sb.run('deploy.sh', [pin, '--ci-verified']);
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /another deploy is running/);
    assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
    assert.equal(sb.calls().length, 0);
    assert.equal(sb.hasMarker(pin), true, 'the marker is not consumed by a run that never started');
  } finally { holder.kill('SIGKILL'); }
}));

test('lock: a rollback cannot overlap a deploy either', () => withSb((sb) => {
  const holder = holdLock(sb);
  try {
    const r = sb.run('rollback.sh', [sb.base]);
    assert.equal(r.status, 3, r.out);
  } finally { holder.kill('SIGKILL'); }
}));

test('lock: released after a run, so the next run proceeds', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']).status, 0);
  assert.equal(sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']).status, 0);
}));

test('lock: a dry-run also takes the lock (it must not interleave with a real run)', () => withSb((sb) => {
  const pin = standardChange(sb);
  const holder = holdLock(sb);
  try {
    assert.equal(sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']).status, 3);
  } finally { holder.kill('SIGKILL'); }
}));

// ---- rollback ---------------------------------------------------------------------
function twoDeploys(sb) {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' }, 'one');
  const c2 = sb.commit({ 'backend/src/a.txt': 'two\n', 'storefront/x.txt': 'x\n' }, 'two');
  sb.git('pull', '-q', '--ff-only');
  return [c1, c2];
}

test('rollback: happy path is code-only, rebuilds all three apps and restarts in order', () => withSb((sb) => {
  const [c1] = twoDeploys(sb);
  const r = sb.run('rollback.sh', [c1]);
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.git('rev-parse', 'HEAD'), c1);
  assert.match(r.out.trim().split('\n').pop(), /^DEPLOY_RESULT=OK$/);
  assert.match(r.out, /Database NOT restored/);
  const c = sb.calls();
  for (const app of ['backend', 'storefront', 'admin']) assert.ok(c.some((x) => x === `npm[${app}] run build`), app);
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend', 'pm2 restart requital-storefront', 'pm2 restart requital-admin']);
  assert.equal(c.filter((x) => /^(backup-db|restore-db|mysqldump)|db:migrate|DROP DATABASE/.test(x)).length, 0, 'no database restore or migration');
}));

test('rollback: --dry-run changes nothing', () => withSb((sb) => {
  const [c1, c2] = twoDeploys(sb);
  const r = sb.run('rollback.sh', [c1, '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /DRYRUN OK/);
  assert.match(r.out, /WOULD DO: NO database restore/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c2);
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart)/.test(c)).length, 0);
}));

test('rollback: dirty tree refused', () => withSb((sb) => {
  const [c1, c2] = twoDeploys(sb);
  fs.appendFileSync(path.join(sb.prod, 'backend/src/a.txt'), 'hotfix\n');
  const r = sb.run('rollback.sh', [c1]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not clean/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c2);
}));

test('rollback: target not an ancestor of HEAD is refused (side branch)', () => withSb((sb) => {
  twoDeploys(sb);
  const side = sb.sideCommit({ 'backend/src/a.txt': 'side\n' });
  sb.git('fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
  const r = sb.run('rollback.sh', [side]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of the current HEAD/);
}));

test('rollback: a roll-FORWARD target is refused (rollback only goes backwards)', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  const c2 = sb.commit({ 'backend/src/a.txt': 'two\n' });
  const r = sb.run('rollback.sh', [c2]);
  assert.equal(r.status, 2, r.out);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
  assert.ok(c1);
}));

test('rollback: a target only reachable from local-only commits is refused (not on origin/main)', () => withSb((sb) => {
  fs.writeFileSync(path.join(sb.prod, 'l1.txt'), '1');
  sb.git('add', '-A');
  sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'l1');
  const l1 = sb.git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(sb.prod, 'l2.txt'), '2');
  sb.git('add', '-A');
  sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'l2');
  const r = sb.run('rollback.sh', [l1]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not reachable from origin\/main/);
}));

test('rollback: target equal to HEAD is a no-op', () => withSb((sb) => {
  const r = sb.run('rollback.sh', [sb.base]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /nothing to roll back/);
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart)/.test(c)).length, 0);
}));

test('rollback: unknown commit refused', () => withSb((sb) => {
  const r = sb.run('rollback.sh', ['2'.repeat(40)]);
  assert.equal(r.status, 2, r.out);
}));

test('rollback: notes migrations that stay applied', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  sb.commit({ 'backend/prisma/migrations/20990202000000_m/migration.sql': '-- m\n' });
  sb.git('pull', '-q', '--ff-only');
  const r = sb.run('rollback.sh', [c1, '--dry-run']);
  assert.match(r.out, /20990202000000_m/);
}));

test('rollback: runs from a temp copy so reset --hard may replace rollback.sh', () => withSb((sb) => {
  const real = fs.readFileSync(path.join(__dirname, '..', 'rollback.sh'), 'utf8');
  // The target commit carries a variant whose bytes are shifted by a long comment,
  // so a script that kept reading its own (replaced) file would resume mid-line.
  const variant = real.replace('\n', '\n' + '# padding to shift every byte offset\n'.repeat(60));
  const c1 = sb.commit({ 'tools/deploy/rollback.sh': variant, 'backend/src/a.txt': 'one\n' });
  sb.commit({ 'tools/deploy/rollback.sh': real, 'backend/src/a.txt': 'two\n' });
  sb.git('pull', '-q', '--ff-only');
  const r = cp.spawnSync('bash', [path.join(sb.prod, 'tools/deploy/rollback.sh'), c1], { env: sb.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DEPLOY_RESULT=OK/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c1);
  assert.match(fs.readFileSync(path.join(sb.prod, 'tools/deploy/rollback.sh'), 'utf8'), /padding to shift/);
}));
