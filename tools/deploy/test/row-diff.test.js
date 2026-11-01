'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR } = require('./helpers');
const { compare, touchedIds } = require('../lib/row-diff');

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
