'use strict';
// The deploy gate matches CI job names EXACTLY. If someone renames a job in
// ci.yml, this test fails in the same PR, so the deploy gate can never silently
// drift into "never finds the check" (fail closed) without anyone noticing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { REPO } = require('./helpers');
const { REQUIRED_CHECKS } = require('../lib/check-runs');

function jobNames(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const names = [];
  let inJobs = false;
  let current = null;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(line) && !/^\s*#/.test(line)) break;
    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (inJobs && job) { current = job[1]; continue; }
    const name = line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (inJobs && current && name) {
      names.push(name[1].replace(/^["']|["']$/g, ''));
      current = null;
    }
  }
  return names;
}

test('ci.yml job names equal the deploy gate list exactly', () => {
  const names = jobNames(path.join(REPO, '.github/workflows/ci.yml'));
  assert.deepEqual([...names].sort(), [...REQUIRED_CHECKS].sort(),
    'A CI job was renamed, added or removed. Update tools/deploy/lib/check-runs.js in the same PR (a mismatch makes deploys fail closed).');
});

test('the parser finds all five jobs (guards the test itself)', () => {
  assert.equal(jobNames(path.join(REPO, '.github/workflows/ci.yml')).length, 5);
});
