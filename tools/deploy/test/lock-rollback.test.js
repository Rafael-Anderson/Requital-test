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
  // Spawn a holder and PROVE the lock is held before returning (retry: under load the
  // flock child can take a moment to start, which used to make these tests flaky).
  for (let attempt = 0; attempt < 5; attempt++) {
    const holder = cp.spawn('flock', ['-n', sb.env.LOCK_FILE, 'sleep', '30'], { stdio: 'ignore' });
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      if (cp.spawnSync('flock', ['-n', sb.env.LOCK_FILE, 'true']).status !== 0) return holder;
      cp.spawnSync('sleep', ['0.1']);
    }
    holder.kill('SIGKILL');
  }
  throw new Error('could not take the lock for the test');
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
  sb.recordDeployed(c1, c2);
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
  sb.recordDeployed(side);
  const r = sb.run('rollback.sh', [side]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of the current HEAD/);
}));

test('rollback: a roll-FORWARD target is refused (rollback only goes backwards)', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  const c2 = sb.commit({ 'backend/src/a.txt': 'two\n' });
  sb.recordDeployed(c1, c2);
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
  sb.recordDeployed(l1);
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
  sb.recordDeployed(c1);
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
  sb.recordDeployed(c1);
  const r = cp.spawnSync('bash', [path.join(sb.prod, 'tools/deploy/rollback.sh'), c1], { env: sb.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DEPLOY_RESULT=OK/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c1);
  assert.match(fs.readFileSync(path.join(sb.prod, 'tools/deploy/rollback.sh'), 'utf8'), /padding to shift/);
}));

// ---- MED-3: only commits this pipeline deployed -------------------------------------------
test('rollback: a sha that is on main and an ancestor but NOT in deployed-shas is refused', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  const c2 = sb.commit({ 'backend/src/a.txt': 'two\n' });
  sb.git('pull', '-q', '--ff-only');
  sb.recordDeployed(c2); // c1 was never deployed by the pipeline
  const r = sb.run('rollback.sh', [c1]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not in .*deployed-shas/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c2);
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart)/.test(c)).length, 0);
}));

test('rollback: with no deployed-shas file at all every target is refused', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  sb.commit({ 'backend/src/a.txt': 'two\n' });
  sb.git('pull', '-q', '--ff-only');
  const r = sb.run('rollback.sh', [c1]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /deployed-shas/);
}));

test('rollback: matching is exact (a prefix or a different sha on a recorded line does not match)', () => withSb((sb) => {
  const c1 = sb.commit({ 'backend/src/a.txt': 'one\n' });
  sb.commit({ 'backend/src/a.txt': 'two\n' });
  sb.git('pull', '-q', '--ff-only');
  fs.mkdirSync(sb.logs, { recursive: true });
  fs.writeFileSync(path.join(sb.logs, 'deployed-shas'), `${c1.slice(0, 39)} 2026-01-01T00:00:00Z x\n${c1}extra 2026-01-01T00:00:00Z x\n`);
  assert.equal(sb.run('rollback.sh', [c1]).status, 2);
}));

test('rollback: a deploy followed by a rollback uses the file deploy.sh wrote', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin);
  assert.equal(sb.run('deploy.sh', [pin, '--ci-verified']).status, 0);
  const r = sb.run('rollback.sh', [sb.base]); // the "previous" sha recorded by the deploy
  assert.equal(r.status, 0, r.out);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
}));

test('rollback leaves no temporary files, and its header no longer claims "once a legitimate main commit" suffices', () => withSb((sb) => {
  const [c1] = twoDeploys(sb);
  assert.equal(sb.run('rollback.sh', [c1]).status, 0);
  assert.deepEqual(sb.tmpLeftovers(), []);
  const head = fs.readFileSync(path.join(__dirname, '..', 'rollback.sh'), 'utf8').slice(0, 1800);
  assert.match(head, /deployed-shas/);
  assert.doesNotMatch(head, /once a legitimate main commit/);
}));

// ---- a rollback repairs a broken system: it must not insist on a healthy one --------------------------------
test('MED-1: a deploy that leaves storefront errored can still be rolled back to PROD', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.marker(pin);
  const dep = sb.run('deploy.sh', [pin, '--ci-verified'], { FAKE_PM2_FAIL: 'requital-storefront' });
  assert.equal(dep.status, 1, dep.out);
  assert.match(dep.out, /did not come online/);
  assert.ok(fs.existsSync(path.join(sb.fakeDir, 'errored-requital-storefront')), 'the fake left storefront errored');
  const rb = sb.run('rollback.sh', [sb.base]);
  assert.equal(rb.status, 0, rb.out);
  assert.match(rb.out, /WARNING: pm2 process 'requital-storefront' is 'errored'/);
  assert.equal(sb.git('rev-parse', 'HEAD'), sb.base);
  assert.equal(fs.existsSync(path.join(sb.fakeDir, 'errored-requital-storefront')), false, 'the restart repaired it');
}));

test('MED-1: a stopped backend does not block a rollback either, but a pm2 process that does not exist does', () => withSb((sb) => {
  const [c1] = twoDeploys(sb);
  const stopped = sb.run('rollback.sh', [c1, '--dry-run'], { FAKE_PM2_DOWN: 'requital-backend' });
  assert.equal(stopped.status, 0, stopped.out);
  assert.match(stopped.out, /'requital-backend' is 'stopped'/);
  const ghost = sb.run('rollback.sh', [c1, '--dry-run'], { PM2_ADMIN: 'requital-ghost' });
  assert.equal(ghost.status, 1, ghost.out);
  assert.match(ghost.out, /pm2 process 'requital-ghost' not found/);
}));

test('MED-1: deploy.sh stays strict about pm2 (an errored process is a refusal there)', () => withSb((sb) => {
  const pin = standardChange(sb);
  fs.writeFileSync(path.join(sb.fakeDir, 'errored-requital-admin'), '');
  const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /is not online/);
}));

test('MED-2: rollback.sh itself carries on when its git fetch fails (origin gone)', () => withSb((sb) => {
  const [c1, c2] = twoDeploys(sb);
  sb.git('remote', 'set-url', 'origin', '/nonexistent-origin');
  const r = sb.run('rollback.sh', [c1]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /WARNING: git fetch failed; continuing with the existing origin\/main/);
  assert.equal(sb.git('rev-parse', 'HEAD'), c1);
  assert.ok(c2);
}));

test('MED-2: with origin gone the on-main check still applies to a sha that is not on the existing origin/main', () => withSb((sb) => {
  twoDeploys(sb);
  const commitLocal = (name) => {
    fs.writeFileSync(path.join(sb.prod, name), name);
    sb.git('add', '-A');
    sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', name);
    return sb.git('rev-parse', 'HEAD');
  };
  const l1 = commitLocal('l1.txt');
  commitLocal('l2.txt');
  sb.recordDeployed(l1);
  sb.git('remote', 'set-url', 'origin', '/nonexistent-origin');
  const refused = sb.run('rollback.sh', [l1]);
  assert.equal(refused.status, 2, refused.out);
  assert.match(refused.out, /WARNING: git fetch failed/);
  assert.match(refused.out, /not reachable from origin\/main/);
}));

test('MED-2: end to end, the REAL rollback.sh behind the REAL entry script with origin removed', () => {
  const sb = makeSandbox(); // no stubs: the checked-out rollback.sh runs
  try {
    const [c1, c2] = twoDeploys(sb);
    sb.git('remote', 'set-url', 'origin', '/nonexistent-origin');
    const r = sb.entry(`rollback ${c1}`, { ENTRY_PATH: sb.env.PATH });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Warning: git fetch failed; continuing with the existing origin\/main/, 'from the entry script');
    assert.match(r.out, /WARNING: git fetch failed; continuing with the existing origin\/main/, 'from rollback.sh');
    assert.match(r.out, /DEPLOY_RESULT=OK/);
    assert.equal(sb.git('rev-parse', 'HEAD'), c1);
    assert.ok(c2);
  } finally { sb.cleanup(); }
});
