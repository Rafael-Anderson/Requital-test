'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { DEPLOY_DIR } = require('./helpers');
const { REQUIRED_CHECKS, evaluate } = require('../lib/check-runs');

const run = (name, o = {}) => ({ id: 1, name, status: 'completed', conclusion: 'success', started_at: '2026-01-01T00:00:00Z', app: { slug: 'github-actions', id: 15368 }, ...o });
const allGreen = () => REQUIRED_CHECKS.map((n, i) => run(n, { id: i + 1 }));

test('the required list is exactly the five pinned names', () => {
  assert.deepEqual(REQUIRED_CHECKS, [
    'backend (tsc, unit, e2e)',
    'admin (tsc, lint, vitest, build)',
    'storefront (tsc, lint, vitest, build)',
    'guardrails (outlet-scoping, page-width, sendEmail)',
    'e2e (playwright)',
  ]);
});

test('all green passes', () => assert.equal(evaluate({ check_runs: allGreen() }).ok, true));

test('each missing check fails and is named', () => {
  for (const name of REQUIRED_CHECKS) {
    const r = evaluate({ check_runs: allGreen().filter((c) => c.name !== name) });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes(name)));
  }
});

test('failed, cancelled, skipped, neutral, timed_out, pending, queued all fail', () => {
  for (const [status, conclusion] of [['completed', 'failure'], ['completed', 'cancelled'], ['completed', 'skipped'], ['completed', 'neutral'], ['completed', 'timed_out'], ['in_progress', null], ['queued', null]]) {
    const runs = allGreen();
    runs[2] = run(REQUIRED_CHECKS[2], { status, conclusion });
    assert.equal(evaluate({ check_runs: runs }).ok, false, `${status}/${conclusion}`);
  }
});

test('near-miss names do not count (exact match only)', () => {
  const runs = allGreen();
  runs[0] = run('backend (tsc, unit, e2e) ');
  assert.equal(evaluate({ check_runs: runs }).ok, false);
  runs[0] = run('Backend (tsc, unit, e2e)');
  assert.equal(evaluate({ check_runs: runs }).ok, false);
  runs[0] = run('backend');
  assert.equal(evaluate({ check_runs: runs }).ok, false);
});

test('a later green re-run replaces an earlier failure; a later failure replaces an earlier green', () => {
  const runs = allGreen();
  runs.push(run(REQUIRED_CHECKS[0], { id: 50, conclusion: 'failure', started_at: '2026-01-01T00:00:00Z' }));
  runs.push(run(REQUIRED_CHECKS[0], { id: 51, started_at: '2026-01-02T00:00:00Z' }));
  assert.equal(evaluate({ check_runs: runs }).ok, true);
  runs.push(run(REQUIRED_CHECKS[0], { id: 52, conclusion: 'failure', started_at: '2026-01-03T00:00:00Z' }));
  assert.equal(evaluate({ check_runs: runs }).ok, false);
});

test('only runs created by the GitHub Actions app count (a spoofed run from another app is ignored)', () => {
  const runs = allGreen();
  // the real run FAILED; a LATER green with the same name comes from another app
  runs[0] = run(REQUIRED_CHECKS[0], { id: 1, conclusion: 'failure' });
  runs.push(run(REQUIRED_CHECKS[0], { id: 99, started_at: '2026-06-01T00:00:00Z', app: { slug: 'some-other-app', id: 7 } }));
  const r = evaluate({ check_runs: runs });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('did not succeed')));
});

test('a green run from another app cannot stand in for a missing real run', () => {
  const runs = allGreen().filter((c) => c.name !== REQUIRED_CHECKS[3]);
  runs.push(run(REQUIRED_CHECKS[3], { app: { slug: 'evil', id: 7 } }));
  assert.equal(evaluate({ check_runs: runs }).ok, false);
});

test('a run with no app field (or app: null) fails closed', () => {
  for (const mutate of [(c) => { delete c.app; }, (c) => { c.app = null; }, (c) => { c.app = {}; }, (c) => { c.app = { slug: 'GitHub-Actions', id: 15368 }; }, (c) => { c.app = { slug: 'github-actions' }; }, (c) => { c.app = { id: 15368 }; }]) {
    const runs = allGreen();
    mutate(runs[4]);
    assert.equal(evaluate({ check_runs: runs }).ok, false);
  }
});

test('the slug alone is not enough: the numeric app id 15368 must match too', () => {
  for (const app of [{ slug: 'github-actions', id: 1 }, { slug: 'github-actions', id: '15368' }, { slug: 'github-actions', id: 15369 }]) {
    const runs = allGreen();
    runs[1] = run(REQUIRED_CHECKS[1], { app });
    assert.equal(evaluate({ check_runs: runs }).ok, false, JSON.stringify(app));
  }
  const { TRUSTED_APP_ID } = require('../lib/check-runs');
  assert.equal(TRUSTED_APP_ID, 15368);
});

test('extra, unrelated check runs are ignored', () => {
  assert.equal(evaluate({ check_runs: [...allGreen(), run('some other app check', { conclusion: 'failure' })] }).ok, true);
});

test('a truncated response (total_count > returned) fails closed', () => {
  assert.equal(evaluate({ total_count: 150, check_runs: allGreen() }).ok, false);
});

test('garbage input fails closed', () => {
  for (const bad of [null, undefined, {}, [], { check_runs: 'x' }, 'str', 7]) assert.equal(evaluate(bad).ok, false);
});

test('CLI: exit codes for green, red and unreadable input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
  try {
    const green = path.join(dir, 'g.json');
    const red = path.join(dir, 'r.json');
    fs.writeFileSync(green, JSON.stringify({ check_runs: allGreen() }));
    fs.writeFileSync(red, JSON.stringify({ check_runs: allGreen().slice(1) }));
    const script = path.join(DEPLOY_DIR, 'lib/check-runs.js');
    assert.equal(cp.spawnSync('node', [script, green]).status, 0);
    assert.equal(cp.spawnSync('node', [script, red]).status, 1);
    assert.equal(cp.spawnSync('node', [script, path.join(dir, 'missing.json')]).status, 2);
    assert.equal(cp.spawnSync('node', [script, '--self-test']).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
