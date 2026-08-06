import { readFileSync } from 'fs';
import { join } from 'path';
import type { SeedState } from './seed';

// Reads the fixture global-setup.ts wrote — a file, not a shared in-memory
// module, because Playwright runs each spec file in its own worker process;
// nothing exported directly from global-setup.ts would survive that boundary.
export function readSeedState(): SeedState {
  const raw = readFileSync(join(__dirname, '.tmp', 'seed-state.json'), 'utf-8');
  return JSON.parse(raw) as SeedState;
}
