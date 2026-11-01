'use strict';
// Structural assertions on .github/workflows/deploy.yml (no YAML dependency: a
// small indentation-aware reader), on the guardrails steps added to ci.yml, on
// the runbook section, and the repo-wide "no em dash" house rule for the files
// this pipeline added.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO, DEPLOY_DIR } = require('./helpers');

const DEPLOY_YML = fs.readFileSync(path.join(REPO, '.github/workflows/deploy.yml'), 'utf8');
const CI_YML = fs.readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
const RUNBOOK = fs.readFileSync(path.join(REPO, 'docs/runbook.md'), 'utf8');
const EM_DASH = String.fromCharCode(0x2014);

const stripComments = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CODE = stripComments(DEPLOY_YML);

const indentOf = (l) => l.match(/^ */)[0].length;

/** All `run:` scripts: [{ script, line }]. Handles `run: |`, `run: >` and one-line forms. */
function runBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    const base = m[1].length + (lines[i].includes('- run:') ? 2 : 0);
    if (/^[|>][-+]?$/.test(m[2])) {
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && indentOf(lines[j]) <= base) break;
        body.push(lines[j]);
      }
      out.push({ script: body.join('\n'), line: i + 1 });
    } else {
      out.push({ script: m[2], line: i + 1 });
    }
  }
  return out;
}

/** The text of a top-level or job-level block: from `^<indent>key:` to the next line at that indent. */
function block(text, indent, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `${' '.repeat(indent)}${key}:` || l.startsWith(`${' '.repeat(indent)}${key}: `));
  if (start < 0) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].trim() !== '' && !/^\s*#/.test(lines[j]) && indentOf(lines[j]) <= indent) { end = j; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('deploy.yml: workflow_dispatch is the ONLY trigger', () => {
  const on = block(CODE, 0, 'on');
  assert.ok(on, 'no on: block');
  const keys = on.split('\n').slice(1).filter((l) => indentOf(l) === 2 && /\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ''));
  assert.deepEqual(keys, ['workflow_dispatch']);
});

test('deploy.yml: never uses pull_request_target, pull_request or push', () => {
  assert.doesNotMatch(CODE, /pull_request_target|pull_request:|^\s*push:|schedule:|workflow_run|repository_dispatch/m);
});

test('deploy.yml: top-level permissions are read-only; checks: read only on the gate job', () => {
  const perms = block(CODE, 0, 'permissions');
  assert.ok(perms, 'no top-level permissions');
  assert.match(perms, /contents: read/);
  assert.doesNotMatch(perms, /write|checks:/);
  assert.equal((CODE.match(/checks: read/g) || []).length, 1);
  const gate = block(CODE, 2, 'gate');
  assert.match(gate, /checks: read/);
  assert.doesNotMatch(CODE, /: write/);
});

test('deploy.yml: concurrency group deploy-production, never cancelling a running deploy', () => {
  const c = block(CODE, 0, 'concurrency');
  assert.ok(c);
  assert.match(c, /group: deploy-production/);
  assert.match(c, /cancel-in-progress: false/);
});

test('deploy.yml: the deploy job uses environment production and a 45 minute timeout', () => {
  const job = block(CODE, 2, 'deploy');
  assert.ok(job);
  assert.match(job, /environment: production/);
  assert.match(job, /timeout-minutes: 45/);
  assert.match(job, /needs: gate/);
  assert.doesNotMatch(block(CODE, 2, 'gate'), /environment:/, 'the gate must not hold the secrets environment');
});

test('deploy.yml: gate runs on refs/heads/main only, and so does the deploy job', () => {
  assert.match(block(CODE, 2, 'gate'), /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(block(CODE, 2, 'deploy'), /if: github\.ref == 'refs\/heads\/main'/);
});

test('deploy.yml: inputs have mode (choice, default dry-run) and sha', () => {
  const inputs = block(CODE, 4, 'inputs');
  assert.ok(inputs);
  const mode = block(inputs, 6, 'mode');
  assert.match(mode, /type: choice/);
  assert.match(mode, /default: dry-run/);
  const options = [...mode.matchAll(/^\s+- (\S+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(options, ['dry-run', 'deploy', 'status', 'rollback']);
  assert.ok(block(inputs, 6, 'sha'));
});

test('deploy.yml: no workflow input, event payload or secret is interpolated into a run: block', () => {
  const blocks = runBlocks(CODE);
  assert.ok(blocks.length >= 3, 'expected at least 3 run blocks');
  for (const { script, line } of blocks) {
    assert.doesNotMatch(script, /\$\{\{/, `run block at line ${line} contains an expression`);
    assert.doesNotMatch(script, /\$\{\{\s*inputs\./);
    assert.doesNotMatch(script, /\$\{\{\s*github\.event/);
  }
});

test('deploy.yml: inputs and secrets reach scripts through env: only', () => {
  for (const m of CODE.matchAll(/\$\{\{\s*(secrets|inputs|needs|steps)\.[^}]*\}\}/g)) {
    const lineStart = CODE.lastIndexOf('\n', m.index) + 1;
    const lineText = CODE.slice(lineStart, CODE.indexOf('\n', m.index));
    assert.match(lineText, /^\s+[A-Z_]+: \$\{\{|^\s+(if|name|sha): |^\s+(outputs|id):/, `unexpected expression use: ${lineText.trim()}`);
  }
});

test('deploy.yml: no shell tracing (set -x) anywhere', () => {
  assert.doesNotMatch(CODE, /set\s+-[a-zA-Z]*x|set\s+-o\s+xtrace|bash\s+-x/);
});

test('deploy.yml: the only third-party action is actions/checkout@v4', () => {
  const uses = [...CODE.matchAll(/^\s*- uses:\s*(\S+)|^\s+uses:\s*(\S+)/gm)].map((m) => m[1] || m[2]);
  assert.ok(uses.length >= 1);
  for (const u of uses) assert.equal(u, 'actions/checkout@v4');
});

test('deploy.yml: ssh is hardened (host key pinned, key-only, batch, keepalive, ip identity)', () => {
  const ssh = runBlocks(CODE).map((b) => b.script).join('\n');
  for (const needle of [
    'StrictHostKeyChecking=yes', 'UserKnownHostsFile=', 'IdentitiesOnly=yes', 'BatchMode=yes', 'ServerAliveInterval=30',
    '::add-mask::$DEPLOY_HOST', '::add-mask::$DEPLOY_USER', 'umask 077', '$RUNNER_TEMP', 'shred -u', 'trap cleanup EXIT',
  ]) assert.ok(ssh.includes(needle), `missing: ${needle}`);
  assert.doesNotMatch(ssh, /StrictHostKeyChecking=(no|accept-new)/);
  assert.doesNotMatch(ssh, /ssh-keyscan/, 'the host key must come from the secret, never be scanned at run time');
});

test('deploy.yml: all four secrets are used, and only in env: blocks', () => {
  for (const s of ['DEPLOY_SSH_KEY', 'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_KNOWN_HOSTS']) {
    assert.match(CODE, new RegExp(`secrets\\.${s}\\b`));
  }
});

test('deploy.yml: the remote command per mode is exactly the allow-listed form', () => {
  const ssh = runBlocks(CODE).map((b) => b.script).join('\n');
  assert.match(ssh, /dry-run\)\s+remote="deploy \$SHA --dry-run --ci-verified"/);
  assert.match(ssh, /deploy\)\s+remote="deploy \$SHA --ci-verified"/);
  assert.match(ssh, /rollback\)\s+remote="rollback \$SHA"/);
  assert.match(ssh, /status\)\s+remote="status"/);
});

// Evaluate a step-level `if:` for a given mode (the expressions here are plain JS-compatible).
function stepIfs(job) {
  const lines = job.split('\n');
  const steps = [];
  let cur = null;
  for (const l of lines) {
    if (/^ {6}- /.test(l)) { cur = { name: l.replace(/^ *- (name: |uses: )?/, ''), ifExpr: null, text: l + '\n' }; steps.push(cur); continue; }
    if (cur) {
      cur.text += l + '\n';
      const m = l.match(/^ {8}if:\s*(.+)$/);
      if (m) cur.ifExpr = m[1];
    }
  }
  return steps;
}
const runsFor = (step, mode) => {
  if (!step.ifExpr) return true;
  const inputs = { mode };
  // eslint-disable-next-line no-new-func
  return Boolean(new Function('inputs', `return (${step.ifExpr});`)(inputs));
};

test('deploy.yml: status mode has no CI gate, no compare and no deploy', () => {
  const gate = block(CODE, 2, 'gate');
  const gateSteps = stepIfs(gate);
  const ci = gateSteps.filter((s) => /check-runs\.js|compare\//.test(s.text));
  assert.equal(ci.length, 2);
  for (const s of ci) assert.equal(runsFor(s, 'status'), false, `${s.name} would run in status mode`);
  // and the remote command for status is the read-only `status` verb
  const ssh = runBlocks(CODE).map((b) => b.script).join('\n');
  const statusArm = ssh.match(/status\)\s+remote="([^"]*)"/)[1];
  assert.equal(statusArm, 'status');
  assert.doesNotMatch(statusArm, /deploy|rollback|--ci-verified/);
});

test('deploy.yml: the full CI check gate applies to dry-run and deploy, the main-ancestry check to rollback too', () => {
  const steps = stepIfs(block(CODE, 2, 'gate'));
  const checks = steps.find((s) => /check-runs\.js/.test(s.text));
  const ancestry = steps.find((s) => /compare\//.test(s.text));
  for (const mode of ['dry-run', 'deploy']) {
    assert.equal(runsFor(checks, mode), true, mode);
    assert.equal(runsFor(ancestry, mode), true, mode);
  }
  assert.equal(runsFor(ancestry, 'rollback'), true);
  assert.equal(runsFor(checks, 'rollback'), false);
});

test('deploy.yml: the gate validates the sha with the shared validator before any use', () => {
  const gate = runBlocks(block(CODE, 2, 'gate')).map((b) => b.script).join('\n');
  assert.match(gate, /tools\/deploy\/lib\/validate-sha\.sh/);
  assert.match(gate, /validate_sha "\$INPUT_SHA"/);
});

test('deploy.yml: contains no em dash', () => assert.equal(DEPLOY_YML.includes(EM_DASH), false));

// ---- ci.yml -----------------------------------------------------------------------
test('ci.yml: the deploy tooling steps live INSIDE the existing guardrails job', () => {
  const jobs = block(CI_YML, 0, 'jobs');
  const guardrails = block(jobs, 2, 'guardrails');
  assert.ok(guardrails);
  assert.match(guardrails, /name: guardrails \(outlet-scoping, page-width, sendEmail\)/, 'job name must not change');
  assert.match(guardrails, /shellcheck -x -P SCRIPTDIR tools\/deploy\/\*\.sh tools\/deploy\/lib\/\*\.sh/);
  assert.match(guardrails, /actionlint/);
  assert.match(guardrails, /sha256sum -c/);
  assert.match(guardrails, /ACTIONLINT_SHA256: "[0-9a-f]{64}"/);
  assert.match(guardrails, /ACTIONLINT_VERSION: "1\.7\.7"/);
  assert.match(guardrails, /node --test tools\/deploy\/test\/\*\.test\.js/);
  for (const other of ['backend', 'admin', 'storefront', 'e2e']) {
    assert.doesNotMatch(block(jobs, 2, other) || '', /tools\/deploy/, `${other} job should not have deploy steps`);
  }
});

test('ci.yml: pre-existing guardrail steps are still present, unrenamed', () => {
  for (const name of [
    'Outlet-scoping guardrail (tenant-isolation)', 'Page-width guardrail', 'Storefront-URL guardrail (per-shop customer links)',
    'sendEmailStub bypass guardrail', 'No-em-dash guardrail (no U+2014 in user-facing strings, all three apps)',
  ]) assert.ok(CI_YML.includes(`- name: ${name}`), name);
});

// ---- shell conventions ----------------------------------------------------------------
test('every tools/deploy shell script follows the repo conventions', () => {
  const files = [
    ...['deploy.sh', 'rollback.sh', 'ssh-entry.sh'].map((f) => path.join(DEPLOY_DIR, f)),
    ...fs.readdirSync(path.join(DEPLOY_DIR, 'lib')).filter((f) => f.endsWith('.sh')).map((f) => path.join(DEPLOY_DIR, 'lib', f)),
  ];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(src.startsWith('#!/usr/bin/env bash\n'), `${f}: shebang`);
    assert.match(src, /docs\/runbook\.md/, `${f}: pointer to the runbook`);
    assert.doesNotMatch(src, /set -x|bash -x/, `${f}: no tracing`);
    assert.equal(src.includes(EM_DASH), false, `${f}: no em dash`);
    assert.doesNotMatch(stripComments(src), /\beval\b/, `${f}: no eval`);
  }
  for (const f of ['deploy.sh', 'rollback.sh', 'ssh-entry.sh']) {
    assert.match(fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8'), /^set -euo pipefail$/m, `${f}: strict mode`);
  }
  for (const f of ['deploy.sh', 'rollback.sh', 'ssh-entry.sh']) {
    const mode = fs.statSync(path.join(DEPLOY_DIR, f)).mode & 0o111;
    assert.ok(mode, `${f} must be executable`);
  }
});

test('no em dash in any file this pipeline added (scripts, tests, workflow, runbook section)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(DEPLOY_DIR)) {
    assert.equal(fs.readFileSync(f, 'utf8').includes(EM_DASH), false, `${f} contains an em dash`);
  }
  const a = RUNBOOK.indexOf('## Deploy via GitHub Actions');
  const b = RUNBOOK.indexOf('## Migration rollback reference');
  assert.ok(a >= 0 && b > a);
  assert.equal(RUNBOOK.slice(a, b).includes(EM_DASH), false, 'runbook section contains an em dash');
});

test('no secrets or token paths were left in the scripts', () => {
  const all = fs.readdirSync(DEPLOY_DIR).filter((f) => f.endsWith('.sh')).map((f) => fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /GITHUB_TOKEN|ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY/);
});

// ---- the checksum column lists stay inside the real schema ----------------------------
test('deploy.sh checksum columns exist in backend/src/db/types.ts', () => {
  const types = fs.readFileSync(path.join(REPO, 'backend/src/db/types.ts'), 'utf8');
  const sh = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8');
  const specs = [...sh.matchAll(/^\s+'(\w+)\|(\w*)\|([\w,]+)'$/gm)];
  assert.ok(specs.length >= 10, `found only ${specs.length} checksum specs`);
  for (const [, table, bound, cols] of specs) {
    const re = new RegExp(`export interface ${table}Row \\{([\\s\\S]*?)\\n\\}`, 'i');
    const m = types.match(re);
    assert.ok(m, `no Row interface for table ${table}`);
    const fields = new Set([...m[1].matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]));
    for (const c of cols.split(',')) assert.ok(fields.has(c), `${table}.${c} is not a column in types.ts`);
    if (bound) assert.ok(fields.has(bound), `${table} bound column ${bound}`);
  }
});

// ---- the runbook section ----------------------------------------------------------------
const section = () => {
  const a = RUNBOOK.indexOf('## Deploy via GitHub Actions');
  return RUNBOOK.slice(a, RUNBOOK.indexOf('## Migration rollback reference'));
};

test('runbook: the bootstrap section has every copy-pasteable step', () => {
  const s = section();
  for (const needle of [
    'ssh-keygen -t ed25519', 'requital-gha-deploy', 'no passphrase',
    'restrict,command="/home/deploy/bin/requital-ssh-entry.sh",no-port-forwarding,no-agent-forwarding,no-pty,no-X11-forwarding',
    'git -C /home/deploy/requital show origin/main:tools/deploy/ssh-entry.sh > /home/deploy/bin/requital-ssh-entry.sh',
    'chmod 755 /home/deploy/bin/requital-ssh-entry.sh', 'sha256sum /home/deploy/bin/requital-ssh-entry.sh',
    'ssh-keyscan -t ed25519', 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
    'DEPLOY_SSH_KEY', 'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_KNOWN_HOSTS',
    'Settings > Environments > New environment', 'Required reviewers', 'Selected branches and tags',
    'Remove-Item', 'Revoking access', 'authorized_keys', 'fail closed', 'tools/deploy/lib/check-runs.js',
    'CODE-ONLY', 'dry-run', 'Not verified', 'DRYRUN OK',
  ]) assert.ok(s.includes(needle), `runbook is missing: ${needle}`);
  assert.doesNotMatch(s, /GITHUB_TOKEN_FILE|personal access token|create a token/i, 'must not recommend a token on the VPS');
});

test('runbook: the ssh-entry.sh sha256 printed in the runbook matches the file', () => {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(DEPLOY_DIR, 'ssh-entry.sh'))).digest('hex');
  const m = section().match(/^([0-9a-f]{64}) {2}\/home\/deploy\/bin\/requital-ssh-entry\.sh$/m);
  assert.ok(m, 'runbook has no sha256 line for ssh-entry.sh');
  assert.equal(m[1], actual, 'ssh-entry.sh changed: update the hash in docs/runbook.md (and the PR description)');
});
