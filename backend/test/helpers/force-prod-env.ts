// Side-effect import: sets NODE_ENV=production BEFORE any app module loads, so
// the per-tier cookie-name constants (auth.constants.ts etc.) bake in their
// production `__Host-` / `__Secure-` prefixes. A spec that needs the prod
// cookie shapes imports this first, then `../src/app.module`. Restore
// NODE_ENV in an afterAll — jest gives each test file its own module registry,
// but process.env is shared per worker.
process.env.NODE_ENV = 'production';
