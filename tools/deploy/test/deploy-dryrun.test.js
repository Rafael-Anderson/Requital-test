'use strict';
// A dry-run runs every read-only gate and changes nothing: no npm, no
// migration, no pm2 restart, no backup, no merge.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeSandbox, standardChange, MUTATING } = require('./helpers');

test('dry-run performs ZERO mutating commands and leaves the checkout alone', () => {
  const sb = makeSandbox({ matrix: true });
  try {
    const pin = standardChange(sb, { 'backend/prisma/migrations/20261124100000_billing_plt1_tables/migration.sql': '-- b\n' });
    const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
    assert.equal(r.status, 0, r.out);
    const calls = sb.calls();
    assert.ok(calls.length > 0, 'the fakes should have been consulted for the read-only gates');
    const bad = calls.filter((c) => MUTATING.some((re) => re.test(c)));
    assert.deepEqual(bad, [], 'dry-run ran a mutating command');
    assert.equal(calls.filter((c) => /^pm2 restart/.test(c)).length, 0);
    assert.equal(calls.filter((c) => /^mysql\[.*\] (DROP|CREATE|INSERT|UPDATE|DELETE|ALTER)/i.test(c)).length, 0);
    assert.equal(sb.git('rev-parse', 'HEAD'), sb.base, 'HEAD must not move');
    assert.equal(sb.git('status', '--porcelain'), '', 'tree must stay clean (no temp matrix script)');
    assert.equal(fs.existsSync(path.join(sb.prod, 'backend/dist')), false);
    assert.equal(fs.existsSync(path.join(sb.root, 'backups')), false, 'no backup dir/file created');
  } finally { sb.cleanup(); }
});

test('dry-run prints WOULD DO lines, DRYRUN OK, and writes the marker with a UTC timestamp', () => {
  const sb = makeSandbox();
  try {
    const pin = standardChange(sb);
    const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
    assert.equal(r.status, 0, r.out);
    assert.ok((r.out.match(/^WOULD DO:/gm) || []).length >= 8);
    assert.match(r.out.trim().split('\n').pop(), /DRYRUN OK/);
    const marker = fs.readFileSync(path.join(sb.logs, `dryrun-ok-${pin}`), 'utf8').trim();
    assert.match(marker, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Math.abs(Date.now() - Date.parse(marker)) < 60000);
    const mode = fs.statSync(path.join(sb.logs, sb.logFiles()[0])).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally { sb.cleanup(); }
});

test('dry-run then real run of the same pin works end to end', () => {
  const sb = makeSandbox();
  try {
    const pin = standardChange(sb);
    assert.equal(sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']).status, 0);
    const r = sb.run('deploy.sh', [pin, '--ci-verified']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out.trim().split('\n').pop(), /^DEPLOY_RESULT=OK$/);
    assert.equal(sb.git('rev-parse', 'HEAD'), pin);
  } finally { sb.cleanup(); }
});

test('a refused or failed dry-run does not leave a marker behind', () => {
  const sb = makeSandbox();
  try {
    const pin = standardChange(sb);
    fs.writeFileSync(path.join(sb.prod, 'junk.txt'), 'x');
    assert.equal(sb.run('deploy.sh', [pin, '--dry-run']).status, 2);
    assert.equal(sb.hasMarker(pin), false);
  } finally { sb.cleanup(); }
});

test('dry-run output carries no secret values', () => {
  const sb = makeSandbox();
  try {
    const pin = standardChange(sb);
    const r = sb.run('deploy.sh', [pin, '--dry-run', '--ci-verified']);
    const log = fs.readFileSync(path.join(sb.logs, sb.logFiles()[0]), 'utf8');
    for (const text of [r.out, log]) {
      assert.doesNotMatch(text, /fake%40pw|fake-not-a-secret|fakeuser|must-not-be-printed/);
    }
  } finally { sb.cleanup(); }
});
