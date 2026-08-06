import { Logger } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';

// Nest's Logger class delegates every instance's log/warn/error/debug calls
// to a single process-global logger reference — the same one
// app.useLogger() sets in main.ts's real bootstrap. That bootstrap never
// runs under Jest (see CLAUDE.md), so without this line every unit and e2e
// test would silently fall back to Nest's own default ConsoleLogger instead
// of the structured JSON one, making the whole redaction/request-context
// mechanism untested. Overriding it here — a module-level side effect that
// runs the first time anything imports createLogger, which is effectively
// "immediately," since almost every service that logs does — means the
// same logger is active everywhere: real deployment, e2e specs, and plain
// unit tests that never touch Nest's DI container at all.
Logger.overrideLogger(new StructuredLoggerService());

// Thin convenience wrapper around Nest's own Logger class, giving every call
// site a (message, meta?) shape instead of Nest's positional
// (message, context) one. Still just `new Logger(...)` underneath — the
// actual JSON formatting/redaction/request-context enrichment all happens
// once, centrally, in StructuredLoggerService. Usable from plain exported
// functions (common/email.ts, common/whatsapp.ts) as well as from
// @Injectable() classes — it doesn't depend on Nest's DI container at all.
export interface AppLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(context: string): AppLogger {
  const logger = new Logger(context);
  return {
    info: (message, meta) =>
      logger.log(meta ? { message, ...meta } : message),
    warn: (message, meta) =>
      logger.warn(meta ? { message, ...meta } : message),
    error: (message, meta) =>
      logger.error(meta ? { message, ...meta } : message),
    debug: (message, meta) =>
      logger.debug(meta ? { message, ...meta } : message),
  };
}
