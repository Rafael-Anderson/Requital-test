import { Injectable } from '@nestjs/common';

const GRAPH_VERSION = 'v21.0';
const TIMEOUT_MS = 10_000;

// The single place a request to Meta is made, an injectable class so tests
// replace it with a stub and no test ever calls the real API.
//
// SECRET HANDLING. The access token goes in the JSON body (Meta accepts
// `access_token` there), not the URL, so it cannot show up in a proxy or access
// log line. Any thrown error is built from the HTTP status and Meta's error
// code only, never from the response body or the original error object, so the
// token cannot reach a job's `lastError`, a log line or a dead-letter view.
@Injectable()
export class MetaCapiClient {
  async send(params: {
    pixelId: string;
    accessToken: string;
    events: unknown[];
    testEventCode?: string | null;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      data: params.events,
      access_token: params.accessToken,
    };
    if (params.testEventCode) body.test_event_code = params.testEventCode;

    let res: Response;
    try {
      res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pixelId)}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      throw new Error('Meta Conversions API request failed (network error)');
    }
    if (!res.ok) {
      let code = '';
      try {
        const json = (await res.json()) as {
          error?: { code?: number; error_subcode?: number; type?: string };
        };
        const e = json.error;
        if (e) {
          code = ` code=${String(e.code ?? '')} subcode=${String(e.error_subcode ?? '')} type=${String(e.type ?? '')}`;
        }
      } catch {
        // unparseable body: status alone is enough
      }
      throw new Error(`Meta Conversions API request failed (HTTP ${res.status})${code}`);
    }
  }
}
