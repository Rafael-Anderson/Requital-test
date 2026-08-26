import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getLogContext } from '../logging/log-context';
import { createLogger } from '../logging/logger';
import type { ErrorTrackingProvider } from './error-tracking.interface';

const logger = createLogger('AllExceptionsFilter');

// The `http-errors` package (used directly by a handful of Express
// ecosystem middlewares this app now uses outside Nest's own request cycle
// — csrf-csrf's doubleCsrfProtection throws a ForbiddenError this way when
// a CSRF check fails) isn't a NestJS HttpException, but it has the same
// real shape: a genuine, well-formed 4xx with a `status`/`statusCode`
// number and a safe-to-return `.message`. Duck-typed rather than an
// `instanceof http-errors.HttpError` check so this also covers any other
// middleware throwing the same shape without adding a direct dependency on
// a package this app never calls directly. Only 4xx is treated this way —
// a >=500 "http-errors-shaped" object still fails closed into the generic
// body below, same as a genuinely unknown error.
function asClientHttpError(
  exception: unknown,
): { status: number; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const status =
    (exception as { status?: unknown; statusCode?: unknown }).status ??
    (exception as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return null;
  }
  return { status, message: exception.message };
}

// Registered as an APP_FILTER provider (see app.module.ts) rather than via
// app.useGlobalFilters() in main.ts — same reason AuthGuard/RolesGuard are
// wired as APP_GUARD there instead of in main.ts: main.ts's bootstrap()
// never runs under Jest (see CLAUDE.md), so a filter only registered there
// would be untested and inactive for every e2e spec.
//
// Additive instrumentation only: for a known HttpException (validation
// errors, 401/403/404s, everything the app already throws deliberately)
// this reproduces Nest's own default response shape exactly
// (exception.getResponse()/getStatus()) — no existing e2e assertion on an
// error message changes. Only a genuinely unhandled, non-HttpException
// error gets a generic body, so a raw internal error/stack never reaches a
// client. Only 5xx / non-HttpException cases are logged at error level and
// forwarded to the error-tracking sink — a routine 400/404 is expected
// traffic, not an incident.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly errorTracking: ErrorTrackingProvider) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const logContext = getLogContext();

    const isHttpException = exception instanceof HttpException;
    const clientHttpError = isHttpException
      ? null
      : asClientHttpError(exception);
    const status = isHttpException
      ? exception.getStatus()
      : (clientHttpError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const body = isHttpException
      ? exception.getResponse()
      : clientHttpError
        ? {
            statusCode: clientHttpError.status,
            message: clientHttpError.message,
          }
        : {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
          };

    // Express's own Request type doesn't strongly type `.route` (it's
    // attached dynamically by the router), so a manual cast is needed to
    // read `.path` off it without an unsafe-member-access lint error.
    const routePath = (request as unknown as { route?: { path?: string } })
      ?.route?.path;
    const errorContext = {
      requestId: logContext?.requestId,
      shopId: logContext?.shopId,
      route: routePath ?? request?.originalUrl,
      method: request?.method,
    };

    if ((!isHttpException && !clientHttpError) || status >= 500) {
      logger.error(
        exception instanceof Error
          ? exception.message
          : 'Unhandled non-Error exception',
        {
          ...errorContext,
          stack: exception instanceof Error ? exception.stack : undefined,
        },
      );
      this.errorTracking.captureException(exception, errorContext);
    }

    response.status(status).json(body);
  }
}
