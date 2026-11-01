'use strict';
// Test harness for tools/deploy: builds a throwaway "VPS" (a bare origin, a prod
// checkout, log/backup/lock dirs) in a temp directory, puts fake binaries
// (npm, pm2, mysql, curl, npx) first on PATH, and runs the REAL scripts from the
// working tree against it. Nothing here touches the network, a database, ssh or
// any real path outside the temp directory. git is real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DEPLOY_DIR = path.join(REPO, 'tools', 'deploy');
const FAKES = path.join(__dirname, 'fakes');
const NODE_DIR = path.dirname(process.execPath);

const GITENV = {
  PATH: process.env.PATH,
  HOME: os.tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd, ...args) {
  const r = cp.spawnSync('git', args, { cwd, env: GITENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

function copyDeployTools(dest, { stubDeploy, stubRollback } = {}) {
  // Copy the working-tree tools/deploy (scripts + lib), without tests.
  const target = path.join(dest, 'tools', 'deploy');
  fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
  for (const f of ['deploy.sh', 'rollback.sh', 'ssh-entry.sh']) {
    fs.copyFileSync(path.join(DEPLOY_DIR, f), path.join(target, f));
    fs.chmodSync(path.join(target, f), 0o755);
  }
  for (const f of fs.readdirSync(path.join(DEPLOY_DIR, 'lib'))) {
    fs.copyFileSync(path.join(DEPLOY_DIR, 'lib', f), path.join(target, 'lib', f));
    fs.chmodSync(path.join(target, 'lib', f), 0o755);
  }
  const stub = '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$FAKE_DIR/captured-argv"\necho "stub ran: $*"\n';
  if (stubDeploy) write(path.join(target, 'deploy.sh'), stub, 0o755);
  if (stubRollback) write(path.join(target, 'rollback.sh'), stub, 0o755);
}

const BACKUP_STUB = `#!/usr/bin/env bash
echo "backup-db.sh $*" >> "$FAKE_LOG"
[ -n "\${DATABASE_URL:-}" ] || { echo "no DATABASE_URL" >&2; exit 1; }
mkdir -p "$1"
f="$1/requital-fake-20990101000000.sql.gz"
if [ "\${FAKE_BACKUP_CORRUPT:-}" = 1 ]; then echo "not gzip" > "$f"; else echo "select 1;" | gzip > "$f"; fi
echo "Backup written to $f"
`;
const RESTORE_STUB = `#!/usr/bin/env bash
echo "restore-db.sh $*" >> "$FAKE_LOG"
[ -n "\${RESTORE_DATABASE_URL:-}" ] || { echo "no RESTORE_DATABASE_URL" >&2; exit 1; }
echo "restored (fake)"
`;

/**
 * makeSandbox({ stubDeploy, stubRollback, matrix })
 * Returns { root, prod, origin, seed, bin, logs, ..., commit(files,msg), run(script,args,env), calls() }.
 */
function makeSandbox(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploytest-'));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const prod = path.join(root, 'prod');
  const bin = path.join(root, 'bin');
  const logs = path.join(root, 'logs');
  const fakeDir = path.join(root, 'fakestate');
  fs.mkdirSync(bin);
  fs.mkdirSync(fakeDir);
  fs.mkdirSync(path.join(root, 'tmp'));
  for (const f of fs.readdirSync(FAKES)) {
    fs.copyFileSync(path.join(FAKES, f), path.join(bin, f));
    fs.chmodSync(path.join(bin, f), 0o755);
  }
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'init', '-b', 'main', seed);
  write(path.join(seed, '.gitignore'), '.env\n.env.local\ndist\n.next\nnode_modules\n');
  write(path.join(seed, 'backend/package.json'), '{}\n');
  write(path.join(seed, 'admin/package.json'), '{}\n');
  write(path.join(seed, 'storefront/package.json'), '{}\n');
  write(path.join(seed, 'backend/src/a.txt'), 'a\n');
  write(path.join(seed, 'backend/prisma/migrations/20260101000000_init/migration.sql'), '-- init\n');
  if (opts.matrix) write(path.join(seed, 'backend/scripts/billing-flag-matrix.ts'), '// fake\n');
  write(path.join(seed, 'tools/backup-db.sh'), BACKUP_STUB, 0o755);
  write(path.join(seed, 'tools/restore-db.sh'), RESTORE_STUB, 0o755);
  copyDeployTools(seed, opts);
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'base');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, prod);
  const base = git(prod, 'rev-parse', 'HEAD');

  // Untracked, ignored production config; deliberately fake values.
  write(path.join(prod, 'backend/.env'), 'DATABASE_URL=mysql://fakeuser:fake%40pw@127.0.0.1:3306/fake_db\nJWT_SECRET=fake-not-a-secret\n');
  write(path.join(prod, 'admin/.env.local'), 'NEXT_PUBLIC_API_URL=http://localhost:3000\n');
  write(path.join(prod, 'storefront/.env.local'), 'NEXT_PUBLIC_API_URL=http://localhost:3000\n');
  write(path.join(fakeDir, 'applied-migrations'), '20260101000000_init\n');

  const env = {
    PATH: `${bin}:${NODE_DIR}:/usr/bin:/bin`,
    HOME: root,
    LANG: 'C',
    TMPDIR: path.join(root, 'tmp'),
    APP_DIR: prod,
    LOG_DIR: logs,
    LOCK_FILE: path.join(root, 'deploy.lock'),
    BACKUP_DIR: path.join(root, 'backups'),
    DEPLOY_USER_EXPECTED: os.userInfo().username,
    MIN_FREE_KB: '1',
    HEALTH_TIMEOUT: '2',
    POLL_INTERVAL: '1',
    STABLE_WAIT: '0',
    FAKE_LOG: path.join(root, 'fake.log'),
    FAKE_DIR: fakeDir,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };

  const sb = {
    root, origin, seed, prod, bin, logs, fakeDir, base, env,
    commit(files, msg = 'change') {
      for (const [f, c] of Object.entries(files)) write(path.join(seed, f), c);
      git(seed, 'add', '-A');
      git(seed, 'commit', '-qm', msg);
      git(seed, 'push', '-q', 'origin', 'main');
      return git(seed, 'rev-parse', 'HEAD');
    },
    // A commit that is NOT on origin/main (pushed to a side branch only).
    sideCommit(files, msg = 'side') {
      git(seed, 'checkout', '-q', '-b', `side-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      for (const [f, c] of Object.entries(files)) write(path.join(seed, f), c);
      git(seed, 'add', '-A');
      git(seed, 'commit', '-qm', msg);
      const sha = git(seed, 'rev-parse', 'HEAD');
      git(seed, 'push', '-q', 'origin', 'HEAD');
      git(seed, 'checkout', '-q', 'main');
      return sha;
    },
    git: (...a) => git(prod, ...a),
    seedGit: (...a) => git(seed, ...a),
    /** Run a script from the working tree's tools/deploy against the sandbox. */
    run(script, args = [], extraEnv = {}, spawnOpts = {}) {
      const r = cp.spawnSync('bash', [path.join(DEPLOY_DIR, script), ...args], {
        env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60000, ...spawnOpts,
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
    },
    /** Run ssh-entry.sh with an SSH_ORIGINAL_COMMAND string. */
    entry(cmd, extraEnv = {}) {
      const e = { ...env, ...extraEnv };
      if (cmd === undefined) delete e.SSH_ORIGINAL_COMMAND; else e.SSH_ORIGINAL_COMMAND = cmd;
      const r = cp.spawnSync('bash', [path.join(DEPLOY_DIR, 'ssh-entry.sh')], { env: e, encoding: 'utf8', timeout: 60000 });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
    },
    calls() {
      return fs.existsSync(env.FAKE_LOG) ? fs.readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean) : [];
    },
    /** Write a fresh dry-run marker for a PIN (age in seconds). */
    marker(pin, ageSeconds = 0) {
      fs.mkdirSync(logs, { recursive: true });
      const t = new Date(Date.now() - ageSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      write(path.join(logs, `dryrun-ok-${pin}`), `${t}\n`);
    },
    /** Record shas as deployed (what a successful deploy.sh writes), so rollback.sh may target them. */
    recordDeployed(...shas) {
      fs.mkdirSync(logs, { recursive: true });
      fs.appendFileSync(path.join(logs, 'deployed-shas'), shas.map((x) => `${x} 2026-01-01T00:00:00Z test\n`).join(''));
    },
    /** Names left behind in the private TMPDIR (must be empty after every run). */
    tmpLeftovers: () => fs.readdirSync(path.join(root, 'tmp')),
    hasMarker: (pin) => fs.existsSync(path.join(logs, `dryrun-ok-${pin}`)),
    logFiles: () => (fs.existsSync(logs) ? fs.readdirSync(logs).filter((f) => f.endsWith('.log')) : []),
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
  return sb;
}

/** A commit that adds `n` backend files with long names: a changed-file list far above the 64 KiB pipe buffer. */
function hugeChange(sb, n = 3000, extra = {}) {
  const files = { ...extra };
  for (let i = 0; i < n; i++) {
    files[`backend/src/generated/${'x'.repeat(48)}-file-number-${String(i).padStart(5, '0')}.txt`] = `${i}\n`;
  }
  return sb.commit(files, 'huge change');
}

/** The standard "something to deploy" commit: backend + storefront + admin change and one new migration. */
function standardChange(sb, extra = {}) {
  return sb.commit({
    'backend/src/a.txt': 'a2\n',
    'storefront/x.txt': 'x\n',
    'admin/y.txt': 'y\n',
    'backend/prisma/migrations/20990101000000_new_thing/migration.sql': '-- new\n',
    ...extra,
  }, 'deploy me');
}

const MUTATING = [
  /^npm\[[a-z]+\] (ci|run build|run db:migrate)/,
  /^pm2 restart/,
  /^backup-db\.sh/,
  /^restore-db\.sh/,
  /^npx /,
  /DROP DATABASE/,
];

module.exports = { REPO, DEPLOY_DIR, makeSandbox, standardChange, hugeChange, git, write, MUTATING, GITENV };
