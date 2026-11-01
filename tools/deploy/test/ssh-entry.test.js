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
    const r = sb.entry(`rollback ${SHA}`);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(captured(sb), [SHA]);
  } finally { sb.cleanup(); }
});

test('the exit code of the script is the exit code of the entry script', () => {
  const sb = makeSandbox({ stubRollback: true });
  try {
    fs.writeFileSync(path.join(sb.prod, 'tools/deploy/rollback.sh'), '#!/usr/bin/env bash\necho failing\nexit 7\n', { mode: 0o755 });
    sb.git('update-index', '--assume-unchanged', 'tools/deploy/rollback.sh');
    const r = sb.entry(`rollback ${SHA}`);
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
