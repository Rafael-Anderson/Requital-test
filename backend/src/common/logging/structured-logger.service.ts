import type { LoggerService } from '@nestjs/common';
import { getLogContext } from './log-context';
import { redact } from './redact';

// Registered app-wide via app.useLogger() in main.ts — every Nest Logger
// instance (new Logger(SomeService.name), Nest's own internal bootstrap
// logs, everything) is routed through this, so there's exactly one place
// that decides the wire format. Writes JSON lines directly to stdout via
// process.stdout.write, never console.* — this file is therefore exempt
// from tools/check-no-console-log.js by construction, not by allowlist.
export class StructuredLoggerService implements LoggerService {
  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace);
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  private write(
    level: string,
    rawMessage: unknown,
    context?: string,
    trace?: string,
  ) {
    const logContext = getLogContext();
    const entry: Record<string, unknown> = {
      level,
      timestamp: new Date().toISOString(),
      ...this.formatMessage(rawMessage),
      ...(context ? { context } : {}),
      ...(logContext?.requestId ? { requestId: logContext.requestId } : {}),
      ...(logContext?.shopId != null ? { shopId: logContext.shopId } : {}),
      ...(trace ? { trace: redact(trace) } : {}),
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  // Accepts a plain string (the common case) or an object — the latter is
  // how call sites attach structured fields (see logging/logger.ts's
  // createLogger helper: logger.warn('message', { shopId, orderId })
  // becomes a single { message, shopId, orderId } object here). Both paths
  // run through redact() so a call site logging a whole object "wholesale"
  // still gets its secrets stripped.
  private formatMessage(raw: unknown): Record<string, unknown> {
    if (raw instanceof Error) {
      return { message: redact(raw.message), stack: redact(raw.stack) };
    }
    if (typeof raw === 'string') {
      return { message: redact(raw) };
    }
    if (raw && typeof raw === 'object') {
      const { message, ...rest } = raw as Record<string, unknown>;
      return {
        message: typeof message === 'string' ? redact(message) : redact(raw),
        ...(Object.keys(rest).length ? { data: redact(rest) } : {}),
      };
    }
    return { message: String(raw) };
  }
}
