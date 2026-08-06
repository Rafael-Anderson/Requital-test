import type { LoggerService } from '@nestjs/common';

// Runs at the very top of main.ts, before NestFactory.create() even starts —
// a misconfigured deployment should fail immediately and loudly, not boot
// halfway and fail confusingly on the first request that touches the
// missing/malformed value (a wrong DATABASE_URL surfacing as a cryptic
// Prisma connection error three requests in, for example).
//
// Scope of "required" is deliberately narrow: only vars with no working
// fallback anywhere in the code. ADMIN_ORIGINS/ADMIN_URL/STOREFRONT_URL
// already have `??` defaults in main.ts/auth.service.ts; RESEND_API_KEY and
// every payment-gateway key are optional-by-design (sendEmail() degrades to
// a stub, PaymentProviderRegistry resolves per-shop) — making any of those
// hard-required here would be a real behavior change for local dev/anyone
// who hasn't configured every optional integration, not a validation fix.
// Present-but-malformed values ARE checked for all of them, required or not.

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// mysql://user:pass@host:port/db — Prisma's own accepted shape for this
// project's datasource (see schema.prisma's provider = "mysql").
function isValidDatabaseUrl(value: string): boolean {
  return /^mysql:\/\/.+/.test(value) && isValidUrl(value);
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

interface EnvVarSpec {
  name: string;
  required: boolean;
  validate?: (value: string) => boolean;
  hint: string;
}

const SPECS: EnvVarSpec[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    validate: isValidDatabaseUrl,
    hint: 'must be a mysql://user:pass@host:port/db connection string',
  },
  {
    name: 'JWT_SECRET',
    required: true,
    hint: 'must be a non-empty string',
  },
  {
    name: 'CREDENTIAL_ENCRYPTION_KEY',
    required: true,
    hint: 'must be a non-empty string',
  },
  {
    name: 'PORT',
    required: false,
    validate: isNumeric,
    hint: 'must be numeric',
  },
  {
    name: 'ADMIN_ORIGINS',
    required: false,
    hint: 'must be a comma-separated list of origins',
  },
  {
    name: 'ADMIN_URL',
    required: false,
    validate: isValidUrl,
    hint: 'must be a valid URL',
  },
  {
    name: 'STOREFRONT_URL',
    required: false,
    validate: isValidUrl,
    hint: 'must be a valid URL',
  },
  {
    name: 'ERROR_TRACKING_WEBHOOK_URL',
    required: false,
    validate: isValidUrl,
    hint: 'must be a valid URL',
  },
  {
    name: 'TAMARA_API_URL',
    required: false,
    validate: isValidUrl,
    hint: 'must be a valid URL',
  },
];

export function validateEnv(logger: LoggerService): void {
  const errors: string[] = [];
  for (const spec of SPECS) {
    const value = process.env[spec.name];
    if (!value) {
      if (spec.required) {
        errors.push(`Missing required environment variable ${spec.name} — ${spec.hint}`);
      }
      continue;
    }
    if (spec.validate && !spec.validate(value)) {
      errors.push(`Invalid environment variable ${spec.name} — ${spec.hint}`);
    }
  }

  if (errors.length > 0) {
    logger.error(
      `Fatal: invalid environment configuration —\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
    process.exit(1);
  }
}
