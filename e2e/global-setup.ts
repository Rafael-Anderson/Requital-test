import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { seedShop } from './seed';

// Playwright's globalSetup runs once, in its own process, before any spec
// file/worker starts — specs run in separate worker processes though, so
// the seeded fixture has to cross that boundary via a file, not an
// in-memory export (see state.ts's own comment).
export default async function globalSetup() {
  const state = await seedShop();
  mkdirSync(join(__dirname, '.tmp'), { recursive: true });
  writeFileSync(
    join(__dirname, '.tmp', 'seed-state.json'),
    JSON.stringify(state, null, 2),
  );
  // eslint-disable-next-line no-console
  console.log(`[e2e seed] shop "${state.subdomain}" ready`);
}
