'use strict';
// The single SHA validator and every surface that uses it. Injection proof: if
// lib/validate-sha.sh is weakened these tests (and the ones for each script's
// own entry check) fail by name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR, makeSandbox } = require('./helpers');

const GOOD = 'a'.repeat(20) + '0123456789'.repeat(2);
const CANARY_NAME = 'CANARY_SHOULD_NOT_EXIST';

// [label, value]: every one must be rejected everywhere.
const BAD = [
  ['empty', ''],
  ['39 chars', GOOD.slice(0, 39)],
  ['41 chars', GOOD + 'a'],
  ['non-hex letters', 'g'.repeat(40)],
  ['non-hex tail', GOOD.slice(0, 39) + 'z'],
  ['space inside', GOOD.slice(0, 20) + ' ' + GOOD.slice(21)],
  ['trailing newline (41)', GOOD + '\n'],
  ['embedded newline (40)', GOOD.slice(0, 20) + '\n' + GOOD.slice(21)],
  ['leading space (41)', ' ' + GOOD],
  ['tab', GOOD.slice(0, 20) + '\t' + GOOD.slice(21)],
  ['semicolon injection (40)', `;touch ${CANARY_NAME};`.padEnd(40, 'a')],
  ['command substitution (40)', `$(touch ${CANARY_NAME})`.padEnd(40, 'a')],
  ['backticks (40)', `\`touch ${CANARY_NAME}\``.padEnd(40, 'a')],
  ['pipe (40)', `|touch ${CANARY_NAME}|`.padEnd(40, 'a')],
  ['ampersand (40)', `&&touch ${CANARY_NAME}&&`.padEnd(40, 'a')],
  ['--dry-run as sha', '--dry-run'],
  ['option-like (40)', '--upload-pack=x'.padEnd(40, 'a')],
  ['leading dash (40)', '-' + GOOD.slice(1)],
  ['ref name', 'main'],
  ['HEAD', 'HEAD'],
  ['origin/main', 'origin/main'],
  ['short sha', 'abc1234'],
  ['unicode lookalike (40)', GOOD.slice(0, 39) + 'а'],
  ['0x prefix', '0x' + GOOD.slice(2)],
  ['quotes (40)', `'${GOOD.slice(1, 39)}'`],
];

function inTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valsha-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('validate-sha.sh (CLI): accepts a good sha and lower-cases it', () => {
  const r = cp.spawnSync('bash', [path.join(DEPLOY_DIR, 'lib/validate-sha.sh'), GOOD.toUpperCase()], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), GOOD);
});

for (const [label, value] of BAD) {
  test(`validate-sha.sh (CLI) rejects: ${label}`, () => {
    inTmp((cwd) => {
      const r = cp.spawnSync('bash', [path.join(DEPLOY_DIR, 'lib/validate-sha.sh'), value], { encoding: 'utf8', cwd });
      assert.notEqual(r.status, 0, `accepted ${JSON.stringify(value)}`);
      assert.equal(r.stdout, '');
      assert.equal(fs.existsSync(path.join(cwd, CANARY_NAME)), false, 'injection executed');
    });
  });

  test(`validate_sha (sourced function) rejects: ${label}`, () => {
    inTmp((cwd) => {
      const r = cp.spawnSync('bash', ['-c', `. "${path.join(DEPLOY_DIR, 'lib/validate-sha.sh')}"; validate_sha "$1"`, '_', value], { encoding: 'utf8', cwd });
      assert.notEqual(r.status, 0, `accepted ${JSON.stringify(value)}`);
      assert.equal(fs.existsSync(path.join(cwd, CANARY_NAME)), false);
    });
  });

  test(`deploy.sh rejects before doing anything: ${label}`, () => {
    const sb = makeSandbox();
    try {
      const r = sb.run('deploy.sh', [value], {}, { cwd: sb.root });
      assert.equal(r.status, 2, r.out);
      assert.equal(fs.existsSync(sb.logs), false, 'must not even create the log dir');
      assert.equal(fs.existsSync(path.join(sb.root, CANARY_NAME)), false);
      assert.deepEqual(sb.calls(), []);
    } finally { sb.cleanup(); }
  });

  test(`rollback.sh rejects before doing anything: ${label}`, () => {
    const sb = makeSandbox();
    try {
      const r = sb.run('rollback.sh', [value], {}, { cwd: sb.root });
      assert.equal(r.status, 2, r.out);
      assert.equal(fs.existsSync(sb.logs), false);
      assert.equal(fs.existsSync(path.join(sb.root, CANARY_NAME)), false);
      assert.deepEqual(sb.calls(), []);
    } finally { sb.cleanup(); }
  });
}

test('deploy.sh / rollback.sh: sha missing entirely is a usage error', () => {
  const sb = makeSandbox();
  try {
    assert.equal(sb.run('deploy.sh', []).status, 2);
    assert.equal(sb.run('rollback.sh', []).status, 2);
  } finally { sb.cleanup(); }
});

test('deploy.sh rejects unknown flags, a second positional and a flag where the sha belongs', () => {
  const sb = makeSandbox();
  try {
    for (const args of [
      [GOOD, '--force'], [GOOD, '--dry-run', '--nope'], [GOOD, GOOD], [GOOD, ''], [GOOD, '-n'],
      ['--dry-run', GOOD], [GOOD, '--dry-run=1'], [GOOD, '--ci-verified=yes'], [GOOD, '--DRY-RUN'],
    ]) {
      const r = sb.run('deploy.sh', args);
      assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.out}`);
      assert.equal(fs.existsSync(sb.logs), false);
    }
    for (const args of [[GOOD, '--force'], [GOOD, '--ci-verified'], [GOOD, GOOD]]) {
      assert.equal(sb.run('rollback.sh', args).status, 2, JSON.stringify(args));
    }
  } finally { sb.cleanup(); }
});

test('ssh-entry.sh refuses a malformed sha inside an otherwise valid verb', () => {
  const sb = makeSandbox({ stubDeploy: true, stubRollback: true });
  try {
    for (const [, value] of BAD) {
      if (/[^A-Za-z0-9 -]/.test(value) || value === '') continue; // those die earlier on the charset check, covered in ssh-entry.test.js
      for (const verb of ['deploy', 'rollback']) {
        const r = sb.entry(`${verb} ${value}`);
        assert.equal(r.status, 126, `${verb} ${value}: ${r.out}`);
      }
    }
    assert.equal(fs.existsSync(path.join(sb.fakeDir, 'captured-argv')), false);
  } finally { sb.cleanup(); }
});

test('mixed-case sha is normalised to lower case by deploy.sh', () => {
  const sb = makeSandbox();
  try {
    const r = sb.run('deploy.sh', [sb.base.toUpperCase(), '--dry-run']);
    assert.match(r.out, new RegExp(`PIN=${sb.base} `));
  } finally { sb.cleanup(); }
});
