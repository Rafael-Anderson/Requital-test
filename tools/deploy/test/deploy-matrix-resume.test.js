'use strict';
// The billing flag matrix gate compares the per-shop key INTERSECTION (a PIN that adds
// a feature key must pass), and a re-run of a PIN whose HEAD is already the PIN is
// either "already deployed" (last real run OK) or RESUME (it failed at step 10 or
// later) or refused (it failed in or before the data gates).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSandbox, standardChange } = require('./helpers');
const { compare } = require('../lib/matrix-diff.js');

const BILLING = { 'backend/prisma/migrations/20261124100000_billing_plt1_tables/migration.sql': '-- b\n' };
const CK = { count: 1, bitXor: '1' };
const doc = (matrix, extra = {}) => ({ matrix, shop: CK, shopfeatureoverride: { count: 0, bitXor: '0' }, shopSuspension: null, ...extra });

function real(sb, pin, env = {}, extra = []) {
  sb.marker(pin);
  return sb.run('deploy.sh', [pin, '--ci-verified', ...extra], env);
}
function withSb(fn, opts) {
  const sb = makeSandbox(opts);
  try { return fn(sb); } finally { sb.cleanup(); }
}
const restarts = (sb) => sb.calls().filter((c) => /^pm2 restart/.test(c));
const setMatrix = (sb, before, after) => {
  fs.writeFileSync(path.join(sb.fakeDir, 'matrix-before.json'), JSON.stringify(before));
  fs.writeFileSync(path.join(sb.fakeDir, 'matrix-after.json'), JSON.stringify(after));
};
const stateLines = (sb) => {
  const f = path.join(sb.logs, 'run-state');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};
// every real run leaves a STARTED line first (a hard kill skips every trap); these are the outcome lines
const outcomes = (sb) => stateLines(sb).filter((l) => !/ REAL STARTED /.test(l));
const ELEVEN = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i % 2 === 0]));
const FOURTEEN = { ...ELEVEN, k11: false, k12: false, k13: false };

// ---- the pure comparison ----------------------------------------------------------------
test('matrix-diff: a PIN that adds keys passes when every new key is false and every shared value is unchanged', () => {
  const r = compare(doc({ 1: ELEVEN, 2: ELEVEN }), doc({ 1: FOURTEEN, 2: FOURTEEN }));
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.deepEqual(r.newKeys, ['k11', 'k12', 'k13']);
  assert.equal(r.sharedValues, 22);
});

test('matrix-diff: a changed shared value fails and names the shop, the key, before and after', () => {
  const after = { ...FOURTEEN, k02: false };           // k02 was true
  const r = compare(doc({ 1: ELEVEN, 7: ELEVEN }), doc({ 1: FOURTEEN, 7: after }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['MISMATCH shop=7 feature=k02 before=true after=false']);
});

test('matrix-diff: a new key that resolves true for any shop fails', () => {
  const r = compare(doc({ 1: ELEVEN, 2: ELEVEN }), doc({ 1: FOURTEEN, 2: { ...FOURTEEN, k12: true } }));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /shop=2 feature=k12 is new .* resolves true/);
});

test('matrix-diff: a key that existed before and is gone after fails (never silently ignored)', () => {
  const { k00, ...rest } = ELEVEN; void k00;
  const r = compare(doc({ 1: ELEVEN }), doc({ 1: rest }));
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /shop=1 feature=k00 existed BEFORE \(true\) and is gone AFTER/);
});

test('matrix-diff: a shop present on one side only fails', () => {
  assert.equal(compare(doc({ 1: ELEVEN }), doc({ 1: ELEVEN, 2: ELEVEN })).ok, false);
  assert.equal(compare(doc({ 1: ELEVEN, 2: ELEVEN }), doc({ 1: ELEVEN })).ok, false);
});

test('matrix-diff: the shop and override checksums stay strict', () => {
  const r = compare(doc({ 1: ELEVEN }), doc({ 1: ELEVEN }, { shop: { count: 1, bitXor: '2' } }));
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /shop checksum before=\[count=1 bitXor=1\] after=\[count=1 bitXor=2\]/);
  assert.equal(compare(doc({ 1: ELEVEN }), doc({ 1: ELEVEN }, { shopfeatureoverride: { count: 1, bitXor: '5' } })).ok, false);
});

test('matrix-diff: suspensionReason absent before is fine when the backfill left no suspended shop without a reason', () => {
  const ok = compare(doc({ 1: ELEVEN }), doc({ 1: ELEVEN }, { shopSuspension: { count: 1, bitXor: '3', suspendedWithoutReason: 0 } }));
  assert.equal(ok.ok, true, ok.problems.join('\n'));
  const bad = compare(doc({ 1: ELEVEN }), doc({ 1: ELEVEN }, { shopSuspension: { count: 1, bitXor: '3', suspendedWithoutReason: 2 } }));
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /2 suspended shop\(s\) have no reason/);
});

test('matrix-diff: suspensionReason present on both sides must be identical, and cannot disappear', () => {
  const a = { count: 1, bitXor: '3', suspendedWithoutReason: 0 };
  assert.equal(compare(doc({ 1: ELEVEN }, { shopSuspension: a }), doc({ 1: ELEVEN }, { shopSuspension: a })).ok, true);
  assert.equal(compare(doc({ 1: ELEVEN }, { shopSuspension: a }), doc({ 1: ELEVEN }, { shopSuspension: { ...a, bitXor: '4' } })).ok, false);
  assert.equal(compare(doc({ 1: ELEVEN }, { shopSuspension: a }), doc({ 1: ELEVEN })).ok, false);
});

test('matrix-diff CLI: exit codes 0 / 1 / 2', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mdiff-'));
  try {
    const w = (n, o) => { const f = path.join(dir, n); fs.writeFileSync(f, JSON.stringify(o)); return f; };
    const cli = path.join(__dirname, '../lib/matrix-diff.js');
    const run = (a, b) => cp.spawnSync('node', [cli, a, b], { encoding: 'utf8' });
    const ok = run(w('b.json', doc({ 1: ELEVEN })), w('a.json', doc({ 1: FOURTEEN })));
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /new keys \(false for every shop\): k11, k12, k13/);
    const bad = run(w('b2.json', doc({ 1: ELEVEN })), w('a2.json', doc({ 1: { ...FOURTEEN, k00: false } })));
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MISMATCH shop=1 feature=k00 before=true after=false/);
    assert.equal(run(path.join(dir, 'missing.json'), w('a3.json', doc({}))).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- inside deploy.sh ---------------------------------------------------------------------
test('deploy: a PIN that adds three feature keys (new keys false everywhere) is deployed', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  setMatrix(sb, doc({ 1: ELEVEN, 2: ELEVEN }), doc({ 1: FOURTEEN, 2: FOURTEEN }));
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /billing flag matrix: 22 shared shop\/key value\(s\) identical/);
  assert.match(r.out, /new keys \(false for every shop\): k11, k12, k13/);
  assert.match(r.out, /billing flag matrix: identical before\/after/);
  assert.equal(restarts(sb).length, 3);
}, { matrix: true }));

test('deploy: a changed shared value stops before any restart, prints the diff, and leaves both matrices in the log dir', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  setMatrix(sb, doc({ 1: ELEVEN, 9: ELEVEN }), doc({ 1: FOURTEEN, 9: { ...FOURTEEN, k04: false } }));
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /MISMATCH shop=9 feature=k04 before=true after=false/);
  assert.match(r.out, /STOP: billing flag matrix differs/);
  assert.equal(restarts(sb).length, 0);
  const files = fs.readdirSync(sb.logs).filter((f) => /^matrix-.*-(before|after)\.json$/.test(f));
  assert.equal(files.length, 2, files.join(','));
  const before = JSON.parse(fs.readFileSync(path.join(sb.logs, files.find((f) => f.endsWith('-before.json'))), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.join(sb.logs, files.find((f) => f.endsWith('-after.json'))), 'utf8'));
  assert.equal(Object.keys(before.matrix['1']).length, 11);
  assert.equal(Object.keys(after.matrix['1']).length, 14);
  assert.equal(fs.statSync(path.join(sb.logs, files[0])).mode & 0o077, 0, 'private mode');
  assert.match(r.out, /both matrices were written to/);
}, { matrix: true }));

test('deploy: a new key that is true for a shop stops before any restart', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  setMatrix(sb, doc({ 1: ELEVEN }), doc({ 1: { ...FOURTEEN, k13: true } }));
  const r = real(sb, pin);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /shop=1 feature=k13 is new .* resolves true/);
  assert.equal(restarts(sb).length, 0);
}, { matrix: true }));

// ---- HEAD == PIN: already deployed vs resume vs refuse -------------------------------------
test('state: every real run is recorded (OK) and a later run of the same PIN is "already deployed"', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin).status, 0);
  assert.match(stateLines(sb)[0], new RegExp(`^\\S+ ${pin} REAL STARTED step=5 prev=${sb.base}$`));
  const lines = outcomes(sb);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^\\S+ ${pin} REAL OK step=14 prev=${sb.base}$`));
  sb.calls(); fs.writeFileSync(sb.env.FAKE_LOG, '');
  const again = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /ALREADY DEPLOYED/);
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart|backup)/.test(c)).length, 0);
  assert.equal(stateLines(sb).length, 2, 'a no-op run records nothing (STARTED + OK from the first run only)');
}));

test('state: HEAD == PIN with nothing recorded (a manual deploy) is "already deployed"', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.git('fetch', 'origin', 'main'); sb.git('merge', '--ff-only', pin);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ALREADY DEPLOYED/);
}));

test('state: a failed real run is recorded with its step and the commit that was running before', () => withSb((sb) => {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_CRASHLOOP: 'requital-backend' });
  assert.equal(r.status, 1, r.out);
  const lines = outcomes(sb);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^\\S+ ${pin} REAL FAILED step=11 prev=${sb.base}$`));
}));

test('state: a dry-run and a refused run record nothing', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(sb.run('deploy.sh', [pin, '--ci-verified']).status, 2, 'real run without a marker is refused');
  assert.equal(sb.run('deploy.sh', [pin, '--dry-run']).status, 0);
  assert.deepEqual(stateLines(sb), []);
}));

function failedAtStep11(sb) {
  const pin = standardChange(sb);
  const r = real(sb, pin, { FAKE_CRASHLOOP: 'requital-backend' });
  assert.equal(r.status, 1, r.out);
  // what the real migration did before the failure: the new migration is now applied
  fs.appendFileSync(path.join(sb.fakeDir, 'applied-migrations'), '20990101000000_new_thing\n');
  for (const f of fs.readdirSync(sb.fakeDir)) if (/^(restarted|errored|restarts)-/.test(f)) fs.rmSync(path.join(sb.fakeDir, f));
  fs.writeFileSync(sb.env.FAKE_LOG, '');
  return pin;
}

test('resume: HEAD == PIN after a run that failed at step 11 rebuilds, restarts and finishes without backup, merge or migration', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  assert.equal(sb.git('rev-parse', 'HEAD'), pin);
  const r = real(sb, pin);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /RESUME mode/);
  assert.match(r.out, /DEPLOY_RESULT=OK/);
  const c = sb.calls();
  assert.equal(c.filter((x) => /^(backup-db|restore-db)\.sh/.test(x)).length, 0, 'no backup');
  assert.equal(c.filter((x) => /db:migrate/.test(x)).length, 0, 'no migration');
  assert.equal(c.filter((x) => /^npx /.test(x)).length, 0, 'no matrix run');
  assert.equal(c.filter((x) => /npm\[backend\] (ci|run build)/.test(x)).length, 0, 'backend not rebuilt');
  assert.equal(c.filter((x) => /DROP DATABASE|BIT_XOR/.test(x)).length, 0, 'no data gates');
  assert.deepEqual(restarts(sb), ['pm2 restart requital-backend', 'pm2 restart requital-storefront', 'pm2 restart requital-admin']);
  assert.match(r.out, new RegExp(`PREVIOUS_SHA=${sb.base}`));
  const lines = outcomes(sb);
  assert.match(lines[lines.length - 1], new RegExp(`${pin} REAL OK step=14 prev=${sb.base}$`));
  // and afterwards the PIN is simply "already deployed"
  assert.match(sb.run('deploy.sh', [pin, '--ci-verified']).out, /ALREADY DEPLOYED/);
}));

test('resume: still needs a fresh dry-run of the PIN (the marker is consumed), and the dry-run changes nothing', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  const noMarker = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(noMarker.status, 2, noMarker.out);
  assert.match(noMarker.out, /no dry-run marker/);
  const dry = sb.run('deploy.sh', [pin, '--dry-run']);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /WOULD DO \(RESUME\)/);
  assert.match(dry.out, /DRYRUN OK/);
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart|backup-db|restore-db)/.test(c)).length, 0);
  assert.equal(sb.hasMarker(pin), true);
  assert.equal(sb.run('deploy.sh', [pin, '--ci-verified']).status, 0);
  assert.equal(sb.hasMarker(pin), false, 'consumed');
}));

test('resume: refused when migrations are still pending', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  fs.writeFileSync(path.join(sb.fakeDir, 'applied-migrations'), '20260101000000_init\n');   // the migration is NOT applied
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /RESUME mode needs a fully migrated database/);
  assert.equal(restarts(sb).length, 0);
}));

test('resume: refused when backend/dist/main.js is missing', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  fs.rmSync(path.join(sb.prod, 'backend/dist'), { recursive: true, force: true });
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /needs backend\/dist\/main\.js/);
  assert.equal(restarts(sb).length, 0);
}));

test('resume: a run that failed at step 9 (migration) is NEVER resumed, with a clear message and nothing changed', () => withSb((sb) => {
  const pin = standardChange(sb);
  const first = real(sb, pin, { FAKE_MIGRATE_FAIL: '1' });
  assert.equal(first.status, 1, first.out);
  assert.match(first.out, /DEPLOY_RESULT=FAILED step=9/);
  fs.writeFileSync(sb.env.FAKE_LOG, '');
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /failed at step 9/);
  assert.match(r.out, /NEWER commit/);
  assert.match(r.out, new RegExp(`rollback.sh to the previous commit \\(${sb.base}\\)`));
  assert.equal(sb.calls().filter((c) => /^(npm|pm2 restart|backup-db|restore-db|npx)/.test(c)).length, 0);
  assert.equal(stateLines(sb).filter((l) => /REAL FAILED step=9/.test(l)).length, 1, 'the refusal adds no new state line');
  assert.equal(stateLines(sb).filter((l) => / REAL STARTED /.test(l)).length, 1, 'nor a STARTED line');
}));

test('resume: a matrix STOP at step 9 is not resumable either (the very gate that failed)', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  setMatrix(sb, doc({ 1: ELEVEN }), doc({ 1: { ...FOURTEEN, k00: false } }));
  assert.equal(real(sb, pin).status, 1);
  assert.match(outcomes(sb)[0], /REAL FAILED step=9 /);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /failed at step 9/);
}, { matrix: true }));

test('resume: a corrupt state line (no previous commit) is refused rather than guessed', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  fs.writeFileSync(path.join(sb.logs, 'run-state'), `2026-01-01T00:00:00Z ${pin} REAL FAILED step=11 prev=nothex\n`);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.equal(restarts(sb).length, 0);
}));

test('resume: only the last real run for the PIN counts (an older FAILED followed by OK is "already deployed")', () => withSb((sb) => {
  const pin = standardChange(sb);
  sb.git('fetch', 'origin', 'main'); sb.git('merge', '--ff-only', pin);
  fs.mkdirSync(sb.logs, { recursive: true });
  fs.writeFileSync(path.join(sb.logs, 'run-state'),
    `2026-01-01T00:00:00Z ${pin} REAL FAILED step=11 prev=${sb.base}\n2026-01-01T01:00:00Z ${pin} REAL OK step=14 prev=${sb.base}\n`);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ALREADY DEPLOYED/);
}));

// ---- wiring and documentation ---------------------------------------------------------------
test('deploy.sh compares matrices with lib/matrix-diff.js only (never a whole-document equality)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../deploy.sh'), 'utf8');
  assert.match(src, /compare_matrix \|\| \{ echo "STOP: billing flag matrix differs/);
  assert.doesNotMatch(src, /\[ "\$MATRIX_BEFORE" = "\$MATRIX_AFTER" \]/);
  assert.match(src, /shopSuspension: j\.shopSuspension === undefined \? null/);
});

test('the matrix script checksums suspensionReason only when the column exists, and says the truth about old/new code', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../backend/scripts/billing-flag-matrix.ts'), 'utf8');
  assert.match(src, /information_schema\.columns/);
  assert.match(src, /suspendedWithoutReason/);
  assert.doesNotMatch(src, /Works against both the pre-billing and the post-billing code/);
  assert.match(src, /matrix-diff\.js/);
});

test('runbook documents the intersection rule, the diff output and the resume rules', () => {
  const rb = fs.readFileSync(path.join(__dirname, '../../../docs/runbook.md'), 'utf8');
  for (const needle of [
    'compares the per-shop key intersection, not the whole document',
    'every key that exists only AFTER is `false` for every shop',
    'matrix-<utc>-<sha7>-before.json',
    '`$LOG_DIR/run-state`',
    '**RESUME mode**',
    'FAILED at step 9 or earlier** it is never resumed',
    'a last line of `STARTED`',
    'a `ROLLED_BACK` line',
    'A run that failed at **step 13**',
  ]) assert.ok(rb.includes(needle), `runbook is missing: ${needle}`);
});

test('resume: a recorded previous commit that is not an ancestor of the PIN is refused (the ancestry gate applies to it)', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  const side = sb.sideCommit({ 'backend/src/side.txt': 's\n' });
  fs.writeFileSync(path.join(sb.logs, 'run-state'), `2026-01-01T00:00:00Z ${pin} REAL FAILED step=11 prev=${side}\n`);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not an ancestor of PIN/);
  assert.equal(restarts(sb).length, 0);
}));

// ---- review round 1: unknown states are never "already deployed" or resumed ------------------
const writeState = (sb, text) => { fs.mkdirSync(sb.logs, { recursive: true }); fs.writeFileSync(path.join(sb.logs, 'run-state'), text); };

test('state: every real run leaves a STARTED line before it changes anything', () => withSb((sb) => {
  const pin = standardChange(sb);
  assert.equal(real(sb, pin, { FAKE_CRASHLOOP: 'requital-backend' }).status, 1);
  const lines = stateLines(sb);
  assert.match(lines[0], / REAL STARTED /);
  assert.match(lines[1], / REAL FAILED step=11 /);
}));

test('state: a run killed hard (last line STARTED, HEAD == PIN) is neither "already deployed" nor resumed', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  writeState(sb, `2026-01-01T00:00:00Z ${pin} REAL STARTED step=5 prev=${sb.base}\n`);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /ALREADY DEPLOYED/);
  assert.match(r.out, /did not end cleanly/);
  assert.equal(restarts(sb).length, 0);
}));

test('state: a truncated or garbled REAL line is refused, never "already deployed"', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  for (const bad of [`2026-01-01T00:00:00Z ${pin} REAL FAIL`, `2026-01-01T00:00:00Z ${pin} REAL`, `2026-01-01T00:00:00Z ${pin} REAL ???? step=x prev=y`]) {
    writeState(sb, `${bad}\n`);
    const r = real(sb, pin);
    assert.equal(r.status, 2, `${bad}\n${r.out}`);
    assert.doesNotMatch(r.out, /ALREADY DEPLOYED/);
  }
}));

test('resume: a forged huge or malformed step is refused instead of tripping the integer test', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  for (const step of ['99999999999999999999', '1234', '1x', '', '-1']) {
    writeState(sb, `2026-01-01T00:00:00Z ${pin} REAL FAILED step=${step} prev=${sb.base}\n`);
    const r = real(sb, pin);
    assert.equal(r.status, 2, `step=${step}\n${r.out}`);
    assert.equal(restarts(sb).length, 0);
  }
}));

test('resume: a run that failed at step 13 (.env changed) is not resumed (the new .env would become the baseline)', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  writeState(sb, `2026-01-01T00:00:00Z ${pin} REAL FAILED step=13 prev=${sb.base}\n`);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /step 13/);
  assert.equal(restarts(sb).length, 0);
}));

test('resume: a state line for another PIN is never used', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  const other = 'a'.repeat(40);
  writeState(sb, `2026-01-01T00:00:00Z ${other} REAL FAILED step=11 prev=${sb.base}\n`);
  const r = sb.run('deploy.sh', [pin, '--ci-verified']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ALREADY DEPLOYED/);
}));

test('rollback.sh records ROLLED_BACK for the commit it rolled back, which invalidates its earlier FAILED line', () => withSb((sb) => {
  const pin = failedAtStep11(sb);
  sb.recordDeployed(sb.base);
  const rb = sb.run('rollback.sh', [sb.base]);
  assert.equal(rb.status, 0, rb.out);
  assert.match(outcomes(sb).slice(-1)[0], new RegExp(`${pin} REAL ROLLED_BACK step=0 prev=${sb.base}$`));
  // someone moves HEAD back to the PIN by hand: it must not resume from the stale FAILED line
  sb.git('merge', '--ff-only', pin);
  const r = real(sb, pin);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /RESUME mode|ALREADY DEPLOYED/);
}));

test('deploy: both matrices written on a mismatch are private (mode 600)', () => withSb((sb) => {
  const pin = standardChange(sb, BILLING);
  setMatrix(sb, doc({ 1: ELEVEN }), doc({ 1: { ...FOURTEEN, k00: false } }));
  assert.equal(real(sb, pin).status, 1);
  const files = fs.readdirSync(sb.logs).filter((f) => /^matrix-.*\.json$/.test(f));
  assert.equal(files.length, 2);
  for (const f of files) assert.equal(fs.statSync(path.join(sb.logs, f)).mode & 0o077, 0, f);
}, { matrix: true }));

test('matrix-diff: cannot pass vacuously (empty matrices, shops without flags, missing or non-scalar checksums)', () => {
  assert.equal(compare(doc({}, { shop: { count: 3, bitXor: '1' } }), doc({}, { shop: { count: 3, bitXor: '1' } })).ok, false, 'empty matrix with shops');
  assert.equal(compare(doc({}, { shop: { count: 0, bitXor: '0' } }), doc({}, { shop: { count: 0, bitXor: '0' } })).ok, true, 'no shops at all is believable');
  assert.equal(compare(doc({ 1: {} }), doc({ 1: {} })).ok, false, 'a shop with no flags compares nothing');
  assert.equal(compare(doc({ 1: ELEVEN }, { shop: {} }), doc({ 1: ELEVEN }, { shop: {} })).ok, false, 'undefined checksum equals undefined');
  assert.equal(compare(doc({ 1: ELEVEN }, { shop: { count: [1], bitXor: '1' } }), doc({ 1: ELEVEN }, { shop: { count: 1, bitXor: '1' } })).ok, false, 'array count');
});

test('matrix-diff: inherited object properties are not shops or features', () => {
  const evil = JSON.parse('{"__proto__": {"a": false}, "1": {"k": true}}');
  const r = compare(doc({ 1: { k: true } }), doc(evil));
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /exists only AFTER/);
});

test('deploy.sh checks the copy of the matrices (set -e inside the subshell, a warning instead of a false claim)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../deploy.sh'), 'utf8');
  assert.match(src, /if \( set -e; umask 077; cp "\$WORK_DIR\/matrix-before\.json"/);
  assert.match(src, /WARNING: could not write the matrices to \$LOG_DIR\./);
});

test('an unknown last state is refused through the default branch, not through a pattern that merely happens to match', () => {
  const src = fs.readFileSync(path.join(__dirname, '../deploy.sh'), 'utf8');
  const i = src.indexOf('# STARTED (the run was killed hard');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 900), /refuse "HEAD == PIN and the last real run for it did not end cleanly/);
});
