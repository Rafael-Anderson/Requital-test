import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  SafeFetchError,
  isPublicAddress,
  safeFetchImage,
  type SafeFetchDeps,
  type SafeFetchReason,
} from './safe-fetch';

// A 1x1 PNG and a JPEG header, enough for the magic-byte sniffer.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32),
]);

const PUBLIC_IP = '93.184.216.34';
const HOST = 'images.example.test';

describe('isPublicAddress', () => {
  const refused = [
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.169.254', // cloud metadata
    '169.254.0.1',
    '100.64.0.1', // CGNAT
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '239.255.255.255',
    '255.255.255.255',
    '240.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '::1',
    '::',
    '::2',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1', // same address, hex notation
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe', // 169.254.169.254 mapped
    '::ffff:8.8.8.8', // a mapped PUBLIC address is refused too
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    'not-an-ip',
    '',
  ];
  it.each(refused)('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  const allowed = [
    '8.8.8.8',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
  ];
  it.each(allowed)('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('safeFetchImage', () => {
  let server: https.Server;
  let port: number;
  let ca: string;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let connectedTo: string[];
  let seenRequests: http.IncomingMessage[];
  let resolveCalls: string[];

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fetch-'));
    const keyFile = path.join(dir, 'key.pem');
    const certFile = path.join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-subj',
        `/CN=${HOST}`,
        '-addext',
        `subjectAltName=DNS:${HOST},DNS:cdn.example.test`,
      ],
      { stdio: 'ignore' },
    );
    ca = fs.readFileSync(certFile, 'utf8');
    server = https.createServer(
      { key: fs.readFileSync(keyFile), cert: ca },
      (req, res) => {
        seenRequests.push(req);
        handler(req, res);
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    connectedTo = [];
    seenRequests = [];
    resolveCalls = [];
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    };
  });

  // The transport the production code calls once it has VALIDATED an address.
  // It records that address, then points the socket at the local test server
  // (the validated address is a public one that cannot be reached from here).
  function deps(resolver?: (host: string) => Promise<string[]>): SafeFetchDeps {
    return {
      resolve: (host) => {
        resolveCalls.push(host);
        return resolver ? resolver(host) : Promise.resolve([PUBLIC_IP]);
      },
      transport: (options, _tls, cb) => {
        connectedTo.push(String(options.host));
        return https.request({ ...options, host: '127.0.0.1', port, ca }, cb);
      },
    };
  }

  async function expectRefused(
    url: string,
    reason: SafeFetchReason,
    d: SafeFetchDeps = deps(),
    options = {},
  ) {
    const error = await safeFetchImage(url, options, d).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SafeFetchError);
    expect((error as SafeFetchError).reason).toBe(reason);
    return error as SafeFetchError;
  }

  it('fetches a public https image, connecting to the validated IP with Host and SNI kept', async () => {
    const result = await safeFetchImage(
      `https://${HOST}/a/b.png?x=1`,
      {},
      deps(),
    );
    expect(result.mime).toBe('image/png');
    expect(result.ext).toBe('png');
    expect(result.buffer.equals(PNG)).toBe(true);
    expect(connectedTo).toEqual([PUBLIC_IP]);
    expect(resolveCalls).toEqual([HOST]);
    const req = seenRequests[0];
    expect(req.headers.host).toBe(HOST);
    expect(req.url).toBe('/a/b.png?x=1');
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers['accept-encoding']).toBe('identity');
  });

  it('never forwards cookies a server sets, across a redirect', async () => {
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final.png', 'set-cookie': 'sid=abc' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    };
    await safeFetchImage(`https://${HOST}/start`, {}, deps());
    expect(seenRequests).toHaveLength(2);
    expect(seenRequests[1].headers.cookie).toBeUndefined();
  });

  describe('scheme, userinfo and port', () => {
    it.each([
      ['file:///etc/passwd', 'scheme'],
      ['ftp://example.test/a.png', 'scheme'],
      ['data:image/png;base64,AAAA', 'scheme'],
      ['javascript:alert(1)', 'scheme'],
      ['gopher://example.test/', 'scheme'],
      ['http://images.example.test/a.png', 'scheme'],
      ['https://user:pw@images.example.test/a.png', 'userinfo'],
      ['https://user@images.example.test/a.png', 'userinfo'],
      ['https://images.example.test@127.0.0.1/a.png', 'userinfo'],
      ['https://images.example.test:8443/a.png', 'port'],
      ['https://images.example.test:22/a.png', 'port'],
      ['https://images.example.test:80/a.png', 'port'],
      ['https://images.example.test:3000/a.png', 'port'],
      ['', 'bad_url'],
      ['not a url', 'bad_url'],
      ['https://', 'bad_url'],
    ] as [string, SafeFetchReason][])('refuses %s', async (url, reason) => {
      await expectRefused(url, reason);
      expect(connectedTo).toEqual([]);
      expect(resolveCalls).toEqual([]); // refused before any DNS
    });

    it('refuses a URL longer than 2048 characters', async () => {
      await expectRefused(`https://${HOST}/${'a'.repeat(2100)}.png`, 'bad_url');
    });

    it('http is refused unless a caller explicitly opts in', async () => {
      await expectRefused('http://images.example.test/a.png', 'scheme');
    });
  });

  describe('hostile destinations', () => {
    it.each([
      'https://127.0.0.1/a.png',
      'https://127.1/a.png',
      'https://2130706433/a.png', // decimal form of 127.0.0.1
      'https://0x7f000001/a.png', // hex form
      'https://0177.0.0.1/a.png', // octal form
      'https://10.1.2.3/a.png',
      'https://172.16.0.9/a.png',
      'https://192.168.1.1/a.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/a.png',
      'https://0.0.0.0/a.png',
      'https://224.0.0.1/a.png',
      'https://[::1]/a.png',
      'https://[::]/a.png',
      'https://[fc00::1]/a.png',
      'https://[fe80::1]/a.png',
      'https://[::ffff:127.0.0.1]/a.png',
      'https://[::ffff:7f00:1]/a.png',
      'https://[::ffff:169.254.169.254]/a.png',
    ])(
      'refuses the IP literal %s without any lookup or connection',
      async (url) => {
        await expectRefused(url, 'blocked_address');
        expect(connectedTo).toEqual([]);
        expect(resolveCalls).toEqual([]);
      },
    );

    it.each([
      ['127.0.0.1'],
      ['10.0.0.5'],
      ['172.20.1.1'],
      ['192.168.0.10'],
      ['169.254.169.254'],
      ['100.100.100.100'],
      ['0.0.0.0'],
      ['::1'],
      ['fd00::5'],
      ['fe80::5'],
      ['::ffff:10.0.0.1'],
    ])('refuses a name that resolves to %s', async (address) => {
      await expectRefused(
        `https://${HOST}/a.png`,
        'blocked_address',
        deps(() => Promise.resolve([address])),
      );
      expect(connectedTo).toEqual([]);
    });

    it('refuses a name when ANY of its addresses is private', async () => {
      await expectRefused(
        `https://${HOST}/a.png`,
        'blocked_address',
        deps(() => Promise.resolve([PUBLIC_IP, '10.0.0.5'])),
      );
      await expectRefused(
        `https://${HOST}/a.png`,
        'blocked_address',
        deps(() => Promise.resolve(['10.0.0.5', PUBLIC_IP])),
      );
      expect(connectedTo).toEqual([]);
    });

    it('treats localhost like any other name: by what it resolves to', async () => {
      await expectRefused(
        'https://localhost/a.png',
        'blocked_address',
        deps(() => Promise.resolve(['127.0.0.1', '::1'])),
      );
    });

    it('reports an unresolvable host as dns, not retryable for ENOTFOUND', async () => {
      const error = await expectRefused(
        `https://${HOST}/a.png`,
        'dns',
        deps(() =>
          Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })),
        ),
      );
      expect(error.retryable).toBe(false);
    });

    it('treats an empty answer as a failure', async () => {
      await expectRefused(
        `https://${HOST}/a.png`,
        'dns',
        deps(() => Promise.resolve([])),
      );
    });
  });

  describe('DNS rebinding', () => {
    it('resolves once and connects to that address, so a later private answer is never used', async () => {
      let calls = 0;
      // First answer public, every later answer private: a rebinding resolver.
      const rebinding = () =>
        Promise.resolve(calls++ === 0 ? [PUBLIC_IP] : ['169.254.169.254']);
      const result = await safeFetchImage(
        `https://${HOST}/a.png`,
        {},
        deps(rebinding),
      );
      expect(result.mime).toBe('image/png');
      expect(calls).toBe(1);
      expect(connectedTo).toEqual([PUBLIC_IP]);
    });

    it('refuses when the answer the check sees is the private one', async () => {
      let calls = 0;
      const rebinding = () =>
        Promise.resolve(calls++ === 0 ? ['127.0.0.1'] : [PUBLIC_IP]);
      await expectRefused(
        `https://${HOST}/a.png`,
        'blocked_address',
        deps(rebinding),
      );
      expect(connectedTo).toEqual([]);
    });

    it('re-resolves on a redirect hop and refuses a hop that now answers private', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { location: 'https://cdn.example.test/b.png' });
        res.end();
      };
      const answers: Record<string, string[]> = {
        [HOST]: [PUBLIC_IP],
        'cdn.example.test': ['10.0.0.9'],
      };
      await expectRefused(
        `https://${HOST}/a.png`,
        'blocked_address',
        deps((host) => Promise.resolve(answers[host])),
      );
      expect(connectedTo).toEqual([PUBLIC_IP]); // only the first hop connected
      expect(resolveCalls).toEqual([HOST, 'cdn.example.test']);
    });
  });

  describe('redirects', () => {
    it('follows a relative and an absolute redirect to a public image', async () => {
      handler = (req, res) => {
        if (req.url === '/a') {
          res.writeHead(301, { location: '/b' });
          res.end();
        } else if (req.url === '/b') {
          res.writeHead(302, { location: `https://cdn.example.test/c.png` });
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'image/png' });
          res.end(PNG);
        }
      };
      const result = await safeFetchImage(`https://${HOST}/a`, {}, deps());
      expect(result.finalUrl).toBe('https://cdn.example.test/c.png');
      expect(connectedTo).toHaveLength(3);
    });

    it.each([
      'https://127.0.0.1/secret.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x.png',
      'https://10.0.0.1:8080/x.png',
      'http://images.example.test/a.png',
      'file:///etc/passwd',
      'https://user:pw@images.example.test/a.png',
    ])('refuses a redirect to %s', async (location) => {
      handler = (_req, res) => {
        res.writeHead(302, { location });
        res.end();
      };
      const error = await safeFetchImage(
        `https://${HOST}/a.png`,
        {},
        deps(),
      ).then(
        () => null,
        (e: unknown) => e as SafeFetchError,
      );
      expect(error).toBeInstanceOf(SafeFetchError);
      expect(['blocked_address', 'scheme', 'port', 'userinfo']).toContain(
        error!.reason,
      );
      expect(connectedTo).toEqual([PUBLIC_IP]); // never connected past the first hop
    });

    it('stops at the hop cap', async () => {
      handler = (req, res) => {
        res.writeHead(302, { location: `/${Number(req.url!.slice(1)) + 1}` });
        res.end();
      };
      await expectRefused(`https://${HOST}/0`, 'redirect_limit');
      expect(connectedTo).toHaveLength(4); // the first request plus 3 redirects
    });

    it('refuses a redirect with no Location', async () => {
      handler = (_req, res) => {
        res.writeHead(302);
        res.end();
      };
      await expectRefused(`https://${HOST}/a.png`, 'redirect_invalid');
    });
  });

  describe('response checks', () => {
    it.each([
      ['text/html', 'content_type'],
      ['image/svg+xml', 'content_type'],
      ['application/octet-stream', 'content_type'],
      ['application/json', 'content_type'],
      ['', 'content_type'],
      ['image/tiff', 'content_type'],
    ])('refuses content-type %p', async (type, reason) => {
      handler = (_req, res) => {
        res.writeHead(200, type ? { 'content-type': type } : {});
        res.end(PNG);
      };
      await expectRefused(`https://${HOST}/a.png`, reason as SafeFetchReason);
    });

    it('refuses HTML served under an image content-type (magic bytes)', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end('<html><script>alert(1)</script></html>');
      };
      await expectRefused(`https://${HOST}/a.png`, 'not_image');
    });

    it('refuses an SVG served as image/png', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
        );
      };
      await expectRefused(`https://${HOST}/a.png`, 'not_image');
    });

    it('trusts the bytes over the declared type (png labelled jpeg is kept as png)', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end(PNG);
      };
      const result = await safeFetchImage(`https://${HOST}/a.jpg`, {}, deps());
      expect(result.mime).toBe('image/png');
      expect(result.ext).toBe('png');
    });

    it('accepts a jpeg and a content-type with a charset suffix', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'Image/JPEG; charset=binary' });
        res.end(JPEG);
      };
      const result = await safeFetchImage(`https://${HOST}/a.jpg`, {}, deps());
      expect(result.ext).toBe('jpg');
    });

    it('refuses a declared Content-Length over the cap before reading the body', async () => {
      handler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(10 * 1024 * 1024),
        });
        res.write(PNG);
        // never ends
      };
      await expectRefused(`https://${HOST}/a.png`, 'too_large', deps(), {
        maxBytes: 1024 * 1024,
      });
    });

    it('cuts a streamed body that exceeds the cap with no Content-Length', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        const chunk = Buffer.alloc(64 * 1024, 1);
        const timer = setInterval(() => {
          if (!res.write(chunk)) return;
        }, 1);
        res.on('close', () => clearInterval(timer));
      };
      await expectRefused(`https://${HOST}/a.png`, 'too_large', deps(), {
        maxBytes: 256 * 1024,
      });
    });

    it('refuses a compressed response', async () => {
      handler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-encoding': 'gzip',
        });
        res.end(PNG);
      };
      await expectRefused(`https://${HOST}/a.png`, 'content_encoding');
    });

    it('gives up on a server that never answers (retryable)', async () => {
      handler = () => {
        // never respond
      };
      const error = await expectRefused(
        `https://${HOST}/a.png`,
        'timeout',
        deps(),
        {
          timeoutMs: 300,
        },
      );
      expect(error.retryable).toBe(true);
    });

    it('gives up on a body that stalls half way', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.write(PNG.subarray(0, 10));
      };
      await expectRefused(`https://${HOST}/a.png`, 'timeout', deps(), {
        timeoutMs: 300,
      });
    });

    it('a 404 is permanent and a 503 is retryable', async () => {
      handler = (_req, res) => {
        res.writeHead(404);
        res.end();
      };
      expect(
        (await expectRefused(`https://${HOST}/a.png`, 'status')).retryable,
      ).toBe(false);
      handler = (_req, res) => {
        res.writeHead(503);
        res.end();
      };
      expect(
        (await expectRefused(`https://${HOST}/a.png`, 'status')).retryable,
      ).toBe(true);
    });
  });
});
