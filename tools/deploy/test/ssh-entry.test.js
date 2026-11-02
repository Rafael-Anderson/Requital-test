'use strict';
// The forced command is the whole attack surface of the deploy key: every
// allowed form must work, and every hostile variant must be refused with 126
// without running anything.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR, makeSandbox } = require('./helpers');

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

function captured(sb) {
  const f = path.join(sb.fakeDir, 'captured-argv');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : null;
}

test('allowed: deploy <sha> runs the PIN copy of deploy.sh with exactly that argv', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    const r = sb.entry(`deploy ${pin}`);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /stub ran:/);
    assert.deepEqual(captured(sb), [pin]);
  } finally { sb.cleanup(); }
});

test('allowed: deploy with --dry-run, --ci-verified and both', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    for (const [suffix, want] of [
      [' --dry-run', ['--dry-run']],
      [' --ci-verified', ['--ci-verified']],
      [' --dry-run --ci-verified', ['--dry-run', '--ci-verified']],
    ]) {
      fs.rmSync(path.join(sb.fakeDir, 'captured-argv'), { force: true });
      const r = sb.entry(`deploy ${pin}${suffix}`);
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(captured(sb), [pin, ...want]);
    }
  } finally { sb.cleanup(); }
});

test('argv is rebuilt from captures: an upper-case sha reaches deploy.sh lower-cased', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    const r = sb.entry(`deploy ${pin.toUpperCase()}`);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(captured(sb), [pin]);
  } finally { sb.cleanup(); }
});

test('allowed: rollback <sha> runs the checked-out rollback.sh with exactly that argv', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    const r = sb.entry(`rollback ${sb.base}`);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(captured(sb), [sb.base]);
  } finally { sb.cleanup(); }
});

test('the exit code of the script is the exit code of the entry script', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    fs.writeFileSync(path.join(sb.prod, 'tools/deploy/rollback.sh'), '#!/usr/bin/env bash\necho failing\nexit 7\n', { mode: 0o755 });
    sb.git('update-index', '--assume-unchanged', 'tools/deploy/rollback.sh');
    const r = sb.entry(`rollback ${sb.base}`);
    assert.equal(r.status, 7, r.out);
    assert.match(r.out, /failing/);
  } finally { sb.cleanup(); }
});

test('allowed: status with no logs', () => {
  const sb = makeSandbox();
  try {
    const r = sb.entry('status');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /LAST_DEPLOY_RESULT=none/);
  } finally { sb.cleanup(); }
});

test('allowed: status prints the newest log tail and the last DEPLOY_RESULT', () => {
  const sb = makeSandbox();
  try {
    fs.mkdirSync(sb.logs, { recursive: true });
    const older = path.join(sb.logs, 'deploy-20260101T000000Z-aaaaaaa.log');
    const newer = path.join(sb.logs, 'deploy-20260102T000000Z-bbbbbbb.log');
    fs.writeFileSync(older, 'old line\nDEPLOY_RESULT=FAILED step=9\n');
    fs.writeFileSync(newer, 'new line\nDEPLOY_RESULT=OK\n');
    fs.utimesSync(older, new Date(1000), new Date(1000));
    const r = sb.entry('status');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /new line/);
    assert.doesNotMatch(r.out, /old line/);
    assert.match(r.out, /LAST_DEPLOY_RESULT=OK/);
  } finally { sb.cleanup(); }
});

// ---- hostile variants -----------------------------------------------------------
const CANARY = (sb) => path.join(sb.root, 'canary');
const HOSTILE = (sb) => {
  const c = CANARY(sb);
  const s = SHA;
  return [
    ['unset', undefined],
    ['empty', ''],
    ['space', ' '],
    ['verb only: deploy', 'deploy'],
    ['verb + space', 'deploy '],
    ['verb only: rollback', 'rollback'],
    ['sha with trailing x', `deploy ${s}x`],
    ['trailing spaces', `deploy ${s}  `],
    ['trailing single space', `deploy ${s} `],
    ['leading space', ` deploy ${s}`],
    ['double space', `deploy  ${s}`],
    ['repeated flag', `deploy ${s} --dry-run --dry-run`],
    ['flags out of order', `deploy ${s} --ci-verified --dry-run`],
    ['unknown flag', `deploy ${s} --force`],
    ['unknown flag 2', `deploy ${s} --dry-run --force`],
    ['semicolon', `deploy ${s}; touch ${c}`],
    ['and-and', `deploy ${s} && touch ${c}`],
    ['pipe', `deploy ${s} | touch ${c}`],
    ['backticks', `deploy ${s} \`touch ${c}\``],
    ['dollar paren', `deploy ${s} $(touch ${c})`],
    ['dollar brace', 'deploy ${IFS}'],
    ['newline then command', `deploy ${s}\ntouch ${c}`],
    ['trailing newline', `deploy ${s}\n`],
    ['carriage return', `deploy ${s}\r`],
    ['tab separator', `deploy\t${s}`],
    ['nbsp separator', `deploy ${s}`],
    ['single quote', `deploy ${s}'`],
    ['double quoted sha', `deploy "${s}"`],
    ['39 hex', `deploy ${s.slice(0, 39)}`],
    ['41 hex', `deploy ${s}a`],
    ['non-hex 40', `deploy ${'g'.repeat(40)}`],
    ['ref name', 'deploy main'],
    ['HEAD', 'deploy HEAD'],
    ['origin/main', 'deploy origin/main'],
    ['path traversal', 'deploy ../x'],
    ['help flag', 'deploy --help'],
    ['rollback with flag', `rollback ${s} --dry-run`],
    ['rollback semicolon', `rollback ${s};id`],
    ['rollback double space', `rollback  ${s}`],
    ['rollback ref', 'rollback main'],
    ['status trailing space', 'status '],
    ['status semicolon', 'status;id'],
    ['status with arg', 'status extra'],
    ['STATUS upper', 'STATUS'],
    ['Status mixed', 'Status'],
    ['bash', 'bash'],
    ['bash -c', `bash -c "touch ${c}"`],
    ['sh', 'sh'],
    ['/bin/sh', '/bin/sh'],
    ['cat passwd', 'cat /etc/passwd'],
    ['scp sink', 'scp -t /tmp'],
    ['sftp', '/usr/lib/openssh/sftp-server'],
    ['env', 'env'],
    ['rm', 'rm -rf /'],
    ['redirect out', `deploy ${s} > ${c}`],
    ['redirect in', `deploy ${s} < /etc/passwd`],
    ['git', 'git status'],
    ['uppercase verb', `DEPLOY ${s}`],
    ['ci-verified only', `deploy --ci-verified`],
    ['glob', 'deploy *'],
    ['brace expansion', `deploy ${s}{,x}`],
    ['equals', `deploy=${s}`],
    ['status then newline', 'status\ntouch x'],
  ];
};

test('hostile variants are all refused with 126 and nothing runs', () => {
  const sb = makeSandbox({ stubDeploy: true, stubRollback: true });
  try {
    const cases = HOSTILE(sb);
    assert.ok(cases.length >= 40, `only ${cases.length} hostile variants`);
    for (const [label, cmd] of cases) {
      const r = sb.entry(cmd);
      assert.equal(r.status, 126, `${label} (${JSON.stringify(cmd)}) -> ${r.status}: ${r.out}`);
      assert.equal(captured(sb), null, `${label}: a script ran`);
      assert.equal(fs.existsSync(CANARY(sb)), false, `${label}: injected command executed`);
    }
    assert.equal(fs.existsSync(sb.logs), false, 'a refused request must not create state');
  } finally { sb.cleanup(); }
});

test('the raw SSH_ORIGINAL_COMMAND string is never evaluated: a valid command with a fake PATH shim', () => {
  // If the entry script ever passed the raw string through a shell, a crafted
  // variable would expand. With a strict charset it is refused before any use.
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    const r = sb.entry(`deploy ${pin}`, { X: `touch ${CANARY(sb)}` });
    assert.equal(r.status, 0, r.out);
    assert.equal(fs.existsSync(CANARY(sb)), false);
  } finally { sb.cleanup(); }
});

test('an unknown commit is refused with exit 2 and the stub never runs', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const r = sb.entry(`deploy ${'1'.repeat(40)}`);
    assert.equal(r.status, 2, r.out);
    assert.equal(captured(sb), null);
  } finally { sb.cleanup(); }
});

test('a dropped SSH connection (entry killed with SIGHUP) does not kill the run', async () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const slow = '#!/usr/bin/env bash\nsleep 2\necho finished > "$FAKE_DIR/finished"\n';
    const pin = sb.commit({ 'tools/deploy/deploy.sh': slow });
    const child = cp.spawn('bash', [path.join(DEPLOY_DIR, 'ssh-entry.sh')], {
      env: { ...sb.env, SSH_ORIGINAL_COMMAND: `deploy ${pin}` }, stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 1000));
    child.kill('SIGHUP');
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(fs.existsSync(path.join(sb.fakeDir, 'finished')), true, 'run was killed with the connection');
  } finally { sb.cleanup(); }
});

// ---- MED-2: the entry script itself requires the sha to be on origin/main ----------------
function localOnlyCommit(sb) {
  fs.writeFileSync(path.join(sb.prod, 'local-only.txt'), 'x');
  sb.git('add', '-A');
  sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'local only');
  return sb.git('rev-parse', 'HEAD');
}
function orphanCommit(sb) {
  // an unrelated root commit: a perfectly valid object that is on no branch of origin
  const tree = sb.git('hash-object', '-t', 'tree', '-w', '/dev/null');
  return sb.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit-tree', tree, '-m', 'orphan');
}

test('deploy: a local-only commit (not on origin/main) is refused by the entry script before anything runs', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const bad = localOnlyCommit(sb);
    const r = sb.entry(`deploy ${bad}`);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /not an ancestor of origin\/main/);
    assert.equal(captured(sb), null);
    assert.equal(fs.existsSync(sb.logs) ? fs.readdirSync(sb.logs).length : 0, 0, 'nothing may be extracted or created');
  } finally { sb.cleanup(); }
});

test('deploy: an old unrelated object is refused', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const bad = orphanCommit(sb);
    const r = sb.entry(`deploy ${bad} --dry-run`);
    assert.equal(r.status, 2, r.out);
    assert.equal(captured(sb), null);
  } finally { sb.cleanup(); }
});

test('deploy: a commit that exists only on a side branch is refused', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const side = sb.sideCommit({ 'backend/src/a.txt': 'side\n' });
    sb.git('fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
    const r = sb.entry(`deploy ${side} --ci-verified`);
    assert.equal(r.status, 2, r.out);
    assert.equal(captured(sb), null);
  } finally { sb.cleanup(); }
});

test('rollback: a sha that is not on origin/main is refused by the entry script too', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    for (const bad of [localOnlyCommit(sb), orphanCommit(sb)]) {
      const r = sb.entry(`rollback ${bad}`);
      assert.equal(r.status, 2, r.out);
      assert.equal(captured(sb), null);
    }
  } finally { sb.cleanup(); }
});

test('an ancestor of origin/main is still accepted for both verbs', () => {
  const sb = makeSandbox({ stubDeploy: true, stubRollback: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    assert.equal(sb.entry(`rollback ${sb.base}`).status, 0);
    assert.deepEqual(captured(sb), [sb.base]);
    assert.equal(sb.entry(`deploy ${pin}`).status, 0);
  } finally { sb.cleanup(); }
});

// ---- environment scrubbing -----------------------------------------------------------------
test('the run does not inherit SHELLOPTS, BASH_ENV, PS4, LD_PRELOAD ...', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const dump = '#!/usr/bin/env bash\nprintf "%s|%s|%s|%s|%s\\n" "${SHELLOPTS-unset}" "${BASH_ENV-unset}" "${PS4-unset}" "${LD_PRELOAD-unset}" "${BASH_XTRACEFD-unset}" > "$FAKE_DIR/envdump"\n';
    const pin = sb.commit({ 'tools/deploy/deploy.sh': dump });
    const r = sb.entry(`deploy ${pin}`, { BASH_ENV: '/dev/null', PS4: 'TRACE ', LD_PRELOAD: '', BASH_XTRACEFD: '2' });
    assert.equal(r.status, 0, r.out);
    const seen = fs.readFileSync(path.join(sb.fakeDir, 'envdump'), 'utf8').trim();
    // SHELLOPTS is maintained by bash itself (it reflects the child's own options) and
    // PS4 is bash's default "+ " once unset; everything the caller injected must be gone.
    const [, bashEnv, ps4, ldPreload, xtracefd] = seen.split('|');
    assert.equal(bashEnv, 'unset');
    assert.notEqual(ps4, 'TRACE ');
    assert.equal(ldPreload, 'unset');
    assert.equal(xtracefd, 'unset');
  } finally { sb.cleanup(); }
});

// ---- cleanup on every exit path --------------------------------------------------------------
const leftovers = (sb) => (fs.existsSync(sb.logs) ? fs.readdirSync(sb.logs).filter((f) => f.startsWith('.')) : []);

test('no .entry-* or .run-* litter after a normal run (stubbed deploy leaves its own run dir)', () => {
  const sb = makeSandbox();
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    const r = sb.entry(`deploy ${pin} --dry-run --ci-verified`, { ENTRY_PATH: sb.env.PATH }); // the PIN's own, real deploy.sh
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /DRYRUN OK/);
    assert.deepEqual(leftovers(sb), [], 'the capture file, status file and run directory must all be gone');
  } finally { sb.cleanup(); }
});

test('failed extraction (the commit has no tools/deploy) leaves nothing behind', () => {
  const sb = makeSandbox();
  try {
    sb.seedGit('rm', '-rq', 'tools/deploy');
    sb.seedGit('commit', '-qm', 'remove deploy tooling');
    sb.seedGit('push', '-q', 'origin', 'main');
    const pin = sb.seedGit('rev-parse', 'HEAD');
    const r = sb.entry(`deploy ${pin}`);
    assert.equal(r.status, 2, r.out);
    assert.deepEqual(leftovers(sb), []);
  } finally { sb.cleanup(); }
});

test('an entry killed with SIGTERM removes its capture and status files and the run still finishes', async () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const slow = '#!/usr/bin/env bash\nsleep 2\necho finished > "$FAKE_DIR/finished"\n';
    const pin = sb.commit({ 'tools/deploy/deploy.sh': slow });
    const child = cp.spawn('bash', [path.join(DEPLOY_DIR, 'ssh-entry.sh')], {
      env: { ...sb.env, SSH_ORIGINAL_COMMAND: `deploy ${pin}` }, stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 1000));
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(fs.existsSync(path.join(sb.fakeDir, 'finished')), true, 'the run was killed with the entry');
    const litter = leftovers(sb).filter((f) => f.startsWith('.entry-'));
    assert.deepEqual(litter, [], 'capture/status files must not be left behind');
  } finally { sb.cleanup(); }
});

// ---- proper flush ------------------------------------------------------------------------------
test('all output is delivered before the entry exits (no fixed-sleep flush)', () => {
  const sb = makeSandbox();
  try {
    const noisy = '#!/usr/bin/env bash\nfor i in $(seq 1 20000); do echo "line $i"; done\necho LAST-LINE-MARKER\n';
    const pin = sb.commit({ 'tools/deploy/deploy.sh': noisy });
    const r = sb.entry(`deploy ${pin}`);
    assert.equal(r.status, 0, r.out.slice(-300));
    assert.match(r.stdout, /line 1\n/);
    assert.match(r.stdout, /line 20000\nLAST-LINE-MARKER\n$/);
  } finally { sb.cleanup(); }
});

// ---- the entry's own stderr is redacted ----------------------------------------------------------
test('a failing git fetch prints its error through the redaction filter', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    sb.git('remote', 'set-url', 'origin', 'file:///nonexistent-dir/mysql://root:topsecretpw@dbhost/x');
    const r = sb.entry(`deploy ${sb.base}`);
    assert.equal(r.status, 2, r.out);
    assert.doesNotMatch(r.out, /topsecretpw/);
    assert.match(r.out, /mysql:\/\/root:\*\*\*@dbhost/);
    assert.equal(captured(sb), null);
  } finally { sb.cleanup(); }
});

test('ssh-entry.sh scrubs the environment at the top and does not trace', () => {
  const src = fs.readFileSync(path.join(DEPLOY_DIR, 'ssh-entry.sh'), 'utf8');
  assert.match(src, /^set \+x$/m);
  assert.match(src, /unset SHELLOPTS BASHOPTS BASH_ENV ENV BASH_XTRACEFD PS4 LD_PRELOAD LD_LIBRARY_PATH/);
});

// ---- the capture and status files are removed on EVERY exit path ---------------------------------
const entryFiles = (sb) => (fs.existsSync(sb.logs) ? fs.readdirSync(sb.logs).filter((f) => f.startsWith('.entry-')) : []);

test('capture and status files are removed after a successful run', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    assert.equal(sb.entry(`deploy ${pin}`).status, 0);
    assert.deepEqual(entryFiles(sb), []);
  } finally { sb.cleanup(); }
});

test('capture and status files are removed after a failing run (non-zero exit)', () => {
  const sb = makeSandbox();
  try {
    const pin = sb.commit({ 'tools/deploy/deploy.sh': '#!/usr/bin/env bash\necho failing\nexit 7\n' });
    const r = sb.entry(`deploy ${pin}`);
    assert.equal(r.status, 7, r.out);
    assert.deepEqual(entryFiles(sb), []);
  } finally { sb.cleanup(); }
});

test('capture and status files are removed after a rollback run too', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    assert.equal(sb.entry(`rollback ${sb.base}`).status, 0);
    assert.deepEqual(entryFiles(sb), []);
  } finally { sb.cleanup(); }
});

for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) {
  test(`capture and status files are removed when the entry is killed with ${signal}, and the run still finishes`, async () => {
    const sb = makeSandbox({ stubDeploy: true });
    try {
      const slow = '#!/usr/bin/env bash\nsleep 2\necho finished > "$FAKE_DIR/finished"\n';
      const pin = sb.commit({ 'tools/deploy/deploy.sh': slow });
      const child = cp.spawn('bash', [path.join(DEPLOY_DIR, 'ssh-entry.sh')], {
        env: { ...sb.env, SSH_ORIGINAL_COMMAND: `deploy ${pin}` }, stdio: 'ignore',
      });
      await new Promise((r) => setTimeout(r, 1000));
      assert.ok(entryFiles(sb).length > 0, 'the capture file should exist while the run is going');
      child.kill(signal);
      await new Promise((r) => setTimeout(r, 3500));
      assert.equal(fs.existsSync(path.join(sb.fakeDir, 'finished')), true, 'the run was killed with the entry');
      assert.deepEqual(entryFiles(sb), []);
    } finally { sb.cleanup(); }
  });
}

// ---- paths and PATH are fixed unless a test flag is set -------------------------------------------------
test('without REQUITAL_ENTRY_TEST the entry script ignores APP_DIR, LOG_DIR and ENTRY_PATH', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    fs.mkdirSync(sb.logs, { recursive: true });
    fs.writeFileSync(path.join(sb.logs, 'deploy-20260101T000000Z-aaaaaaa.log'), 'sandbox log line\nDEPLOY_RESULT=OK\n');
    const st = sb.entry('status', { REQUITAL_ENTRY_TEST: undefined, ENTRY_PATH: '/nonexistent' });
    assert.equal(st.status, 0, st.out);
    assert.doesNotMatch(st.out, /sandbox log line/, 'the sandbox LOG_DIR must be ignored');
    assert.match(st.out, /\/home\/deploy\/deploy-logs/);
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    const dep = sb.entry(`deploy ${pin}`, { REQUITAL_ENTRY_TEST: undefined });
    assert.equal(dep.status, 2, dep.out);
    assert.equal(captured(sb), null, 'the sandbox checkout must not be used');
  } finally { sb.cleanup(); }
});

test('with the test flag the overrides work (what every other test here relies on)', () => {
  const sb = makeSandbox({ stubDeploy: true });
  try {
    const pin = sb.commit({ 'backend/src/a.txt': 'changed\n' });
    assert.equal(sb.entry(`deploy ${pin}`).status, 0);
  } finally { sb.cleanup(); }
});

test('the source fixes the paths and PATH in production', () => {
  const src = fs.readFileSync(path.join(DEPLOY_DIR, 'ssh-entry.sh'), 'utf8');
  assert.match(src, /else\n  APP_DIR="\/home\/deploy\/requital"\n  LOG_DIR="\/home\/deploy\/deploy-logs"\n  export PATH="\/usr\/local\/bin:\/usr\/bin:\/bin"\nfi/);
});

// ---- a rollback survives a failing fetch -----------------------------------------------------------------------------
test('rollback: a failing git fetch warns (redacted) and continues with the existing origin/main', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    sb.git('remote', 'set-url', 'origin', 'file:///nonexistent-dir/mysql://root:topsecretpw@dbhost/x');
    const r = sb.entry(`rollback ${sb.base}`);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Warning: git fetch failed; continuing with the existing origin\/main/);
    assert.doesNotMatch(r.out, /topsecretpw/);
    assert.deepEqual(captured(sb), [sb.base]);
  } finally { sb.cleanup(); }
});

test('rollback: with a failing fetch a sha that is NOT on the existing origin/main is still refused', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    const bad = localOnlyCommit(sb);
    sb.git('remote', 'set-url', 'origin', '/nonexistent-dir/x');
    const r = sb.entry(`rollback ${bad}`);
    assert.equal(r.status, 2, r.out);
    assert.equal(captured(sb), null);
  } finally { sb.cleanup(); }
});

// ---- run directory ownership -------------------------------------------------------------------------------------------
test('a run that dies without reporting a status leaves no run directory behind', () => {
  const sb = makeSandbox();
  try {
    // the stub kills its own parent (the status-writing wrapper), so no status is ever written
    const pin = sb.commit({ 'tools/deploy/deploy.sh': '#!/usr/bin/env bash\nkill -9 $PPID\nsleep 1\n' });
    const r = sb.entry(`deploy ${pin}`);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /ended without reporting a status/);
    assert.deepEqual(leftovers(sb), []);
  } finally { sb.cleanup(); }
});

test('RUN_DIR_OWNED is cleared before the background launch (source order)', () => {
  const src = fs.readFileSync(path.join(DEPLOY_DIR, 'ssh-entry.sh'), 'utf8');
  const cleared = src.indexOf('RUN_DIR_OWNED=0   # from the launch on');
  const launch = src.indexOf('env -u SHELLOPTS');
  assert.ok(cleared >= 0, 'the RUN_DIR_OWNED=0 line must exist (a missing line made indexOf return -1 and the old check pass vacuously)');
  assert.ok(launch >= 0 && cleared < launch);
});
