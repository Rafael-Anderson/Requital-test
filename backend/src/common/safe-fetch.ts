import { BlockList, isIP } from 'net';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { sniffImageType } from '../storage/image-sniff';

// SSRF-safe fetcher for ONE job: copy a remote image a merchant listed in an
// import file into our own storage. The URL is attacker-controlled data (a
// merchant, or whoever authored the file they uploaded), so every property
// below is enforced here rather than trusted from the caller:
//
//  * https only. `allowHttp` exists for a caller that explicitly opts in; the
//    importer never does (a plain-http fetch can be rewritten in transit).
//  * No userinfo in the URL, and only the scheme's default port (443/80). A
//    port is how a public name gets pointed at an internal admin service.
//  * DNS is resolved HERE, every returned address is checked against the
//    blocked ranges below, and the socket is then opened to the VALIDATED
//    IP with the original hostname kept for Host and SNI. The name is never
//    resolved a second time, so a rebinding resolver (public first, private
//    second) cannot swap the target between check and connect.
//  * Redirects are followed manually, at most `maxRedirects`, and each hop
//    goes through the full pipeline again (scheme, port, DNS, address check).
//  * Hard caps on bytes (header and streamed), on total wall time, a content
//    type allowlist, and magic-byte sniffing of the body. Compressed
//    responses are refused (we send Accept-Encoding: identity).
//  * Nothing is forwarded: no cookies, no credentials, no caller headers.

export type SafeFetchReason =
  | 'bad_url'
  | 'scheme'
  | 'userinfo'
  | 'port'
  | 'blocked_address'
  | 'dns'
  | 'redirect_limit'
  | 'redirect_invalid'
  | 'status'
  | 'content_type'
  | 'content_encoding'
  | 'too_large'
  | 'timeout'
  | 'not_image'
  | 'network';

export class SafeFetchError extends Error {
  constructor(
    readonly reason: SafeFetchReason,
    message: string,
    // True when trying again later could succeed (timeouts, 5xx, a flaky
    // network). A blocked address or a wrong content type never becomes valid.
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export const SAFE_FETCH_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  allowedContentTypes?: readonly string[];
}

export interface SafeFetchDeps {
  // Every address the name resolves to. Default: the system resolver.
  resolve?: (hostname: string) => Promise<string[]>;
  // Opens the request. Default: https.request / http.request. Tests replace
  // it to observe WHICH ip the code connected to and to reach a local server.
  transport?: (
    options: https.RequestOptions,
    tls: boolean,
    callback: (res: http.IncomingMessage) => void,
  ) => http.ClientRequest;
}

export interface SafeFetchResult {
  buffer: Buffer;
  mime: string;
  ext: string;
  finalUrl: string;
}

const DEFAULTS = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
};

const MAX_URL_LENGTH = 2048;

// ----------------------------------------------------------------- addresses

// Two lists, not one: Node's BlockList treats an IPv4 address as IPv4-mapped
// IPv6 when it is checked against IPv6 rules, so the ::ffff:0:0/96 rule below
// would match EVERY IPv4 address if it shared a list with them.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
const v4 = (net: string, prefix: number) =>
  blocked4.addSubnet(net, prefix, 'ipv4');
const v6 = (net: string, prefix: number) =>
  blocked6.addSubnet(net, prefix, 'ipv6');
v4('0.0.0.0', 8); // "this" network, includes 0.0.0.0
v4('10.0.0.0', 8);
v4('100.64.0.0', 10); // CGNAT
v4('127.0.0.0', 8);
v4('169.254.0.0', 16); // link-local, includes 169.254.169.254 metadata
v4('172.16.0.0', 12);
v4('192.0.0.0', 24);
v4('192.0.2.0', 24);
v4('192.88.99.0', 24);
v4('192.168.0.0', 16);
v4('198.18.0.0', 15);
v4('198.51.100.0', 24);
v4('203.0.113.0', 24);
v4('224.0.0.0', 4); // multicast
v4('240.0.0.0', 4); // reserved, includes 255.255.255.255
v6('::', 96); // unspecified, loopback and the deprecated IPv4-compatible range
v6('::ffff:0:0', 96); // IPv4-mapped: refused whole, in any notation
v6('64:ff9b::', 96); // NAT64
v6('100::', 64); // discard
v6('2001::', 32); // Teredo
v6('2001:db8::', 32); // documentation
v6('2002::', 16); // 6to4
v6('fc00::', 7); // unique local
v6('fe80::', 10); // link-local
v6('fec0::', 10); // site-local (deprecated)
v6('ff00::', 8); // multicast

// True only for an address that is a normal public unicast address.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4
    ? !blocked4.check(address, 'ipv4')
    : !blocked6.check(address, 'ipv6');
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const found = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return found.map((f) => f.address);
}

// -------------------------------------------------------------------- the URL

interface CheckedTarget {
  url: URL;
  tls: boolean;
  ip: string;
  hostname: string;
  isIpLiteral: boolean;
}

function checkUrlShape(raw: string, allowHttp: boolean): URL {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_URL_LENGTH
  ) {
    throw new SafeFetchError('bad_url', 'The image URL is empty or too long');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('bad_url', 'The image URL is not a valid URL');
  }
  const secure = url.protocol === 'https:';
  if (!secure && !(allowHttp && url.protocol === 'http:')) {
    throw new SafeFetchError('scheme', 'Only https image URLs are fetched');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError(
      'userinfo',
      'Image URLs with credentials are refused',
    );
  }
  // new URL() drops the scheme's default port, so any port left is non-default.
  if (url.port !== '') {
    throw new SafeFetchError(
      'port',
      'Image URLs with a custom port are refused',
    );
  }
  if (url.hostname === '') {
    throw new SafeFetchError('bad_url', 'The image URL has no host');
  }
  return url;
}

async function checkTarget(
  raw: string,
  allowHttp: boolean,
  resolve: (hostname: string) => Promise<string[]>,
): Promise<CheckedTarget> {
  const url = checkUrlShape(raw, allowHttp);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const isIpLiteral = isIP(hostname) !== 0;
  let addresses: string[];
  if (isIpLiteral) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new SafeFetchError(
        'dns',
        'The image host could not be resolved',
        code === 'EAI_AGAIN',
      );
    }
  }
  if (addresses.length === 0) {
    throw new SafeFetchError('dns', 'The image host did not resolve');
  }
  // EVERY address must be public: a name that also points at a private
  // address is not trusted, whichever one the socket would have picked.
  if (!addresses.every(isPublicAddress)) {
    throw new SafeFetchError(
      'blocked_address',
      'The image host resolves to a non-public address',
    );
  }
  return {
    url,
    tls: url.protocol === 'https:',
    ip: addresses[0],
    hostname,
    isIpLiteral,
  };
}

// ---------------------------------------------------------------------- fetch

type Outcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'body'; buffer: Buffer; contentType: string };

function requestOnce(
  target: CheckedTarget,
  limits: { maxBytes: number; allowedContentTypes: readonly string[] },
  transport: NonNullable<SafeFetchDeps['transport']>,
  register: (req: http.ClientRequest) => void,
): Promise<Outcome> {
  return new Promise<Outcome>((resolve, reject) => {
    const options: https.RequestOptions = {
      // The socket goes to the address we validated; the name only travels in
      // Host and (for TLS) SNI and certificate verification.
      host: target.ip,
      port: target.tls ? 443 : 80,
      method: 'GET',
      path: `${target.url.pathname}${target.url.search}`,
      headers: {
        Host: target.url.host,
        'User-Agent': 'RequitalImageImport/1.0',
        Accept: 'image/jpeg,image/png,image/webp,image/gif',
        'Accept-Encoding': 'identity',
      },
      agent: false,
    };
    if (target.tls && !target.isIpLiteral) options.servername = target.hostname;

    const req = transport(options, target.tls, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = res.headers.location;
        res.resume();
        if (typeof location !== 'string' || location === '') {
          reject(
            new SafeFetchError(
              'redirect_invalid',
              'A redirect had no Location',
            ),
          );
          return;
        }
        resolve({ kind: 'redirect', location });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(
          new SafeFetchError(
            'status',
            `The image host answered ${status}`,
            status >= 500 || status === 429,
          ),
        );
        return;
      }
      const encoding = String(res.headers['content-encoding'] ?? 'identity')
        .trim()
        .toLowerCase();
      if (encoding !== 'identity' && encoding !== '') {
        res.destroy();
        reject(
          new SafeFetchError(
            'content_encoding',
            'Compressed responses are refused',
          ),
        );
        return;
      }
      const contentType = String(res.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!limits.allowedContentTypes.includes(contentType)) {
        res.destroy();
        reject(
          new SafeFetchError(
            'content_type',
            'The response is not an allowed image type',
          ),
        );
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > limits.maxBytes) {
        res.destroy();
        reject(
          new SafeFetchError(
            'too_large',
            'The image is larger than the size limit',
          ),
        );
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > limits.maxBytes) {
          // Reject FIRST: destroy() emits 'aborted' synchronously, which would
          // otherwise settle the promise as a (retryable) network error.
          reject(
            new SafeFetchError(
              'too_large',
              'The image is larger than the size limit',
            ),
          );
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({ kind: 'body', buffer: Buffer.concat(chunks), contentType }),
      );
      res.on('error', () =>
        reject(new SafeFetchError('network', 'The connection failed', true)),
      );
      res.on('aborted', () =>
        reject(new SafeFetchError('network', 'The connection was cut', true)),
      );
    });
    register(req);
    req.on('error', () =>
      reject(new SafeFetchError('network', 'The connection failed', true)),
    );
    req.end();
  });
}

export async function safeFetchImage(
  rawUrl: string,
  options: SafeFetchOptions = {},
  deps: SafeFetchDeps = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const allowHttp = options.allowHttp === true;
  const allowedContentTypes =
    options.allowedContentTypes ?? SAFE_FETCH_CONTENT_TYPES;
  const resolve = deps.resolve ?? defaultResolve;
  const transport: NonNullable<SafeFetchDeps['transport']> =
    deps.transport ??
    ((o, tls, cb) => (tls ? https.request(o, cb) : http.request(o, cb)));

  let current: ClientRequestRef = { req: null };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      current.req?.destroy();
      reject(
        new SafeFetchError('timeout', 'The image download took too long', true),
      );
    }, timeoutMs);
  });

  const run = async (): Promise<SafeFetchResult> => {
    let url = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // Every hop, the first included, is checked from scratch.
      const target = await checkTarget(url, allowHttp, resolve);
      const outcome = await requestOnce(
        target,
        { maxBytes, allowedContentTypes },
        transport,
        (req) => {
          current = { req };
        },
      );
      if (outcome.kind === 'redirect') {
        let next: URL;
        try {
          next = new URL(outcome.location, target.url);
        } catch {
          throw new SafeFetchError(
            'redirect_invalid',
            'A redirect pointed at an invalid URL',
          );
        }
        url = next.toString();
        continue;
      }
      const sniffed = sniffImageType(outcome.buffer);
      if (!sniffed || !allowedContentTypes.includes(sniffed.mime)) {
        throw new SafeFetchError(
          'not_image',
          'The downloaded file is not a supported image',
        );
      }
      return {
        buffer: outcome.buffer,
        mime: sniffed.mime,
        ext: sniffed.ext,
        finalUrl: target.url.toString(),
      };
    }
    throw new SafeFetchError(
      'redirect_limit',
      'The image URL redirected too many times',
    );
  };

  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
    current.req?.destroy();
  }
}

interface ClientRequestRef {
  req: http.ClientRequest | null;
}
