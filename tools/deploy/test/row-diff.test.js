'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR } = require('./helpers');
const { compare, touchedIds, touchedSummary, capFor } = require('../lib/row-diff');

const B = '1\th1\tU1\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n';
const P = '1\th1\t10\n2\th2\t10\n3\th3\t11\n';

test('identical dumps have nothing changed', () => {
  assert.deepEqual(compare(B, B, { updated: true, parent: true }), { checked: 3, changed: 0, tolerated: 0, fatal: [] });
});

test('a changed row is tolerated only when its updatedAt moved', () => {
  assert.equal(compare(B, '1\tX\tU9\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n', { updated: true }).fatal.length, 0);
  assert.deepEqual(compare(B, '1\tX\tU1\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n', { updated: true }).fatal, ['1']);
});

test('without updatedAt or a touched parent a change is always fatal', () => {
  assert.deepEqual(compare('1\ta\n', '1\tb\n').fatal, ['1']);
  assert.deepEqual(compare('1\ta\n', '').fatal, ['1']);
});

test('a vanished row is tolerated only through a touched parent', () => {
  assert.deepEqual(compare(P, '2\th2\t10\n3\th3\t11\n', { parent: true }).fatal, ['1']);
  assert.equal(compare(P, '2\th2\t10\n3\th3\t11\n', { parent: true, touched: new Set(['10']) }).fatal.length, 0);
  assert.deepEqual(compare(P, '2\th2\t10\n3\th3\t11\n', { parent: true, touched: new Set(['11']) }).fatal, ['1']);
});

test('rows added after BEFORE (ids above the captured max) are ignored', () => {
  assert.equal(compare(B, `${B}4\th4\tU4\t12\n`, { updated: true }).checked, 3);
});

test('touchedIds lists changed and vanished rows', () => {
  assert.deepEqual(touchedIds('1\ta\n2\tb\n3\tc\n', '1\ta\n2\tz\n'), ['2', '3']);
});

test('CLI: compare exit codes and the printed summary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  try {
    const f = (n, t) => { const p = path.join(dir, n); fs.writeFileSync(p, t); return p; };
    const script = path.join(DEPLOY_DIR, 'lib/row-diff.js');
    const ok = cp.spawnSync('node', [script, 'compare', f('b', B), f('a', B), '--updated'], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /checked=3 changed=0 tolerated=0 fatal=0/);
    const bad = cp.spawnSync('node', [script, 'compare', f('b2', B), f('a2', '1\tX\tU1\t10\n2\th2\tU2\t10\n3\th3\tU3\t11\n'), '--updated'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /fatal=1/);
    assert.match(bad.stdout, /fatal ids \(first 5\): 1/);
    const touched = cp.spawnSync('node', [script, 'touched', f('b3', '1\ta\n2\tb\n'), f('a3', '1\ta\n2\tc\n')], { encoding: 'utf8' });
    assert.equal(touched.stdout, '2\n');
    assert.equal(cp.spawnSync('node', [script, '--self-test']).status, 0);
    assert.equal(cp.spawnSync('node', [script, 'bogus']).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const table = (n, bad = 0) => Array.from({ length: n }, (_, i) => `${i + 1}\t${i < bad ? 'x' : 'h'}${i + 1}\n`).join('');

test('capFor: a floor of 10, then 1% rounded up', () => {
  assert.equal(capFor(0), 10);
  assert.equal(capFor(60), 10);
  assert.equal(capFor(1000), 10);
  assert.equal(capFor(1001), 11);
  assert.equal(capFor(2000), 20);
  assert.equal(capFor(100000), 1000);
});

test('touchedSummary: edited orders beyond the cap are flagged', () => {
  const ok = touchedSummary(table(60), table(60, 10));
  assert.deepEqual({ checked: ok.checked, changed: ok.changed, cap: ok.cap, exceeded: ok.exceeded }, { checked: 60, changed: 10, cap: 10, exceeded: false });
  assert.equal(touchedSummary(table(60), table(60, 11)).exceeded, true);
  assert.equal(touchedSummary(table(2000), table(2000, 20)).exceeded, false);
  assert.equal(touchedSummary(table(2000), table(2000, 21)).exceeded, true);
});

test('capped tables tolerate changes and deletions within the cap, and nothing beyond it', () => {
  assert.equal(compare(table(60), table(60, 10), { capped: true }).fatal.length, 0);
  assert.equal(compare(table(60), table(60, 11), { capped: true }).fatal.length, 11);
  const fewer = table(60).split('\n').slice(5).join('\n'); // 5 rows vanished
  assert.equal(compare(table(60), fewer, { capped: true }).tolerated, 5);
  assert.equal(compare(table(60), table(60, 1), { capped: false }).fatal.length, 1, 'without the flag every change is fatal');
});

test('CLI: touched prints ids on stdout, the summary on stderr, exit 1 beyond the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd2-'));
  try {
    const f = (n, t) => { const p = path.join(dir, n); fs.writeFileSync(p, t); return p; };
    const script = path.join(DEPLOY_DIR, 'lib/row-diff.js');
    const ok = cp.spawnSync('node', [script, 'touched', f('b', table(60)), f('a', table(60, 3))], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, '1\n2\n3\n');
    assert.match(ok.stderr, /checked=60 changed=3 cap=10/);
    const bad = cp.spawnSync('node', [script, 'touched', f('b2', table(60)), f('a2', table(60, 50))], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /changed=50 cap=10/);
    const capped = cp.spawnSync('node', [script, 'compare', f('b3', table(60)), f('a3', table(60, 12)), '--capped'], { encoding: 'utf8' });
    assert.equal(capped.status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
