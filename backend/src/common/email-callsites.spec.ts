import * as fs from 'fs';
import * as path from 'path';

// Guards the actual point of this task: every business-logic call site that
// used to call sendEmailStub() directly (order notifications, low-stock
// digest, abandoned cart recovery, gift cards, staff invite/reset/verify,
// customer password reset) must route through sendEmail() instead, so it
// gets the real Resend path when RESEND_API_KEY is configured. A per-file
// behavioral test can't be written for all eight cheaply (most of these
// services have no existing test scaffolding at all — see the "Real email
// delivery" report), but this structural check is cheap and catches the
// actual regression class: a future call site (or a careless revert)
// bypassing the shared wrapper and calling the stub directly again.
describe('no call site bypasses sendEmail() to call sendEmailStub() directly', () => {
  it('only common/email.ts itself references sendEmailStub', () => {
    const srcRoot = path.join(__dirname, '..');
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          if (full === path.join(__dirname, 'email.ts')) continue;
          const src = fs.readFileSync(full, 'utf8');
          if (/\bsendEmailStub\(/.test(src)) offenders.push(path.relative(srcRoot, full));
        }
      }
    }
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
