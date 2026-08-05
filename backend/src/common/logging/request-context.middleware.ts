import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithLogContext } from './log-context';

// Applied to every route (see AppModule.configure) — generates one request
// id per incoming request and runs the rest of the request inside an
// AsyncLocalStorage context carrying it, so every log line emitted anywhere
// during that request (however deep in the call stack) can pick it up
// without threading it through every function signature. Echoed back as a
// response header too, so a client/ops person can correlate a specific
// response with its server-side log lines.
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    runWithLogContext({ requestId }, next);
  }
}
