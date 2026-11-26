// Side-effect module imported by main.ts straight after dotenv and BEFORE the
// app module, so no provider (including a module-scope read) ever sees a
// platform credential with a pasted invisible character. See
// credential-sanitize.ts.
import { sanitizePlatformCredentialEnv } from './credential-sanitize';

sanitizePlatformCredentialEnv();
