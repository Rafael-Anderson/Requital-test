#!/usr/bin/env node
// Pure evaluator for the deploy workflow's CI gate. Given the JSON the GitHub
// API returns for GET /repos/{owner}/{repo}/commits/{sha}/check-runs, decide
// whether every REQUIRED check ran and passed on that commit.
//
// This is the ONLY place the required-check list lives. It must equal the
// `name:` of the jobs in .github/workflows/ci.yml EXACTLY; the test
// tools/deploy/test/ci-job-names.test.js parses ci.yml and fails the build if
// the two ever differ. A renamed CI job therefore makes deploys FAIL CLOSED
// (the gate reports it missing) until this list is updated in the same PR.
//
// Used by .github/workflows/deploy.yml (gate job) only. deploy.sh on the VPS
// never calls the GitHub API and holds no token; it relies on --ci-verified.
//
//   node tools/deploy/lib/check-runs.js <check-runs.json>   evaluate a saved API response
//   node tools/deploy/lib/check-runs.js --self-test         prove the evaluator works
'use strict';
const fs = require('fs');

const REQUIRED_CHECKS = [
  'backend (tsc, unit, e2e)',
  'admin (tsc, lint, vitest, build)',
  'storefront (tsc, lint, vitest, build)',
  'guardrails (outlet-scoping, page-width, sendEmail)',
  'e2e (playwright)',
];

// Only check runs created by the GitHub Actions app count. Any GitHub App (or
// anyone with a token that can create check runs) may publish a run NAMED like a
// required check; a spoofed green must never mask a real failure or stand in for
// a missing run. A run with no app field at all fails closed (it is ignored, so
// the required check reads as missing).
const TRUSTED_APP_SLUG = 'github-actions';

// Newest run wins: a re-run of a failed job replaces the failure, and a later
// failure replaces an earlier success. Newest = latest started_at, then id.
function latest(runs) {
  return runs.slice().sort((a, b) => {
    const ta = Date.parse(a.started_at || '') || 0;
    const tb = Date.parse(b.started_at || '') || 0;
    if (ta !== tb) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  })[0];
}

function evaluate(response, required = REQUIRED_CHECKS) {
  const problems = [];
  const runs = response && Array.isArray(response.check_runs) ? response.check_runs : null;
  if (!runs) return { ok: false, problems: ['response has no check_runs array'] };
  if (typeof response.total_count === 'number' && response.total_count > runs.length) {
    problems.push(`response is truncated (${runs.length} of ${response.total_count} check runs)`);
  }
  for (const name of required) {
    const matching = runs.filter((r) => r && r.name === name && r.app && r.app.slug === TRUSTED_APP_SLUG);
    if (matching.length === 0) {
      problems.push(`required check missing (or not produced by GitHub Actions): ${name}`);
      continue;
    }
    const run = latest(matching);
    if (run.status !== 'completed') {
      problems.push(`required check not finished: ${name} (${run.status})`);
    } else if (run.conclusion !== 'success') {
      problems.push(`required check did not succeed: ${name} (${run.conclusion})`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function selfTest() {
  const ok = (name, id = 1, t = '2026-01-01T00:00:00Z') => ({
    id, name, status: 'completed', conclusion: 'success', started_at: t, app: { slug: 'github-actions' },
  });
  const all = REQUIRED_CHECKS.map((n, i) => ok(n, i + 1));
  const cases = [
    ['all green', { check_runs: all }, true],
    ['missing one', { check_runs: all.slice(1) }, false],
    ['failed', { check_runs: [{ ...all[0], conclusion: 'failure' }, ...all.slice(1)] }, false],
    ['pending', { check_runs: [{ ...all[0], status: 'in_progress', conclusion: null }, ...all.slice(1)] }, false],
    ['rerun fixes', { check_runs: [{ ...all[0], conclusion: 'failure' }, ok(REQUIRED_CHECKS[0], 99, '2026-02-01T00:00:00Z'), ...all.slice(1)] }, true],
    ['later failure wins', { check_runs: [{ ...all[0], conclusion: 'failure', started_at: '2026-03-01T00:00:00Z' }, ...all.slice(1)] }, false],
    ['no array', {}, false],
    ['spoofed later success from another app does not mask a failure', { check_runs: [{ ...all[0], conclusion: 'failure' }, { ...ok(REQUIRED_CHECKS[0], 99, '2026-05-01T00:00:00Z'), app: { slug: 'evil-app' } }, ...all.slice(1)] }, false],
    ['missing app field fails closed', { check_runs: all.map((r) => { const { app, ...rest } = r; return rest; }) }, false],
  ];
  let bad = 0;
  for (const [label, input, want] of cases) {
    const got = evaluate(input).ok;
    if (got !== want) { bad++; console.error(`self-test FAIL: ${label}`); }
  }
  if (bad) process.exit(1);
  console.log(`check-runs self-test passed (${cases.length} cases)`);
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--self-test') {
    selfTest();
  } else if (arg) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(arg, 'utf8'));
    } catch (e) {
      console.error(`Error: cannot read ${arg}: ${e.message}`);
      process.exit(2);
    }
    const r = evaluate(parsed);
    for (const p of r.problems) console.error(`CI gate: ${p}`);
    if (!r.ok) process.exit(1);
    console.log(`CI gate: all ${REQUIRED_CHECKS.length} required checks succeeded`);
  } else {
    console.error('Usage: check-runs.js <check-runs.json> | --self-test');
    process.exit(2);
  }
}

module.exports = { REQUIRED_CHECKS, TRUSTED_APP_SLUG, evaluate, latest };
