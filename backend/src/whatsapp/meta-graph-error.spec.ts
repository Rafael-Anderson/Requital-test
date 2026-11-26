import { friendlyMetaError, parseMetaError } from './meta-graph-error';

const body = (code: number, subcode?: number) =>
  JSON.stringify({
    error: {
      message: 'Meta said no',
      type: 'OAuthException',
      code,
      ...(subcode !== undefined ? { error_subcode: subcode } : {}),
      fbtrace_id: 'AbCdTrace1',
    },
  });

describe('Meta Graph API error mapping', () => {
  it('190 is an invalid or expired token', () => {
    const f = friendlyMetaError(parseMetaError(401, body(190)));
    expect(f.reason).toBe('invalid_token');
    expect(f.message).toMatch(/access token/);
    expect(f.details).toMatchObject({
      metaMessage: 'Meta said no',
      fbtraceId: 'AbCdTrace1',
      code: 190,
    });
  });

  it('100/33 is a Phone Number ID Meta cannot find', () => {
    const f = friendlyMetaError(parseMetaError(400, body(100, 33)));
    expect(f.reason).toBe('phone_number_id_not_found');
    expect(f.message).toMatch(/Phone Number ID/);
  });

  it('10 and 200 are missing permissions', () => {
    expect(friendlyMetaError(parseMetaError(400, body(10))).reason).toBe(
      'missing_permission',
    );
    expect(friendlyMetaError(parseMetaError(403, body(200))).reason).toBe(
      'missing_permission',
    );
  });

  it('anything else is unknown, with Meta message and fbtrace_id kept as details', () => {
    const f = friendlyMetaError(parseMetaError(400, body(131030)));
    expect(f.reason).toBe('unknown');
    expect(f.details.fbtraceId).toBe('AbCdTrace1');
  });

  it('a non-JSON body still maps (no details) and the raw body is never kept', () => {
    const d = parseMetaError(502, '<html>Bad gateway with EAABsecret</html>');
    expect(d).toEqual({
      metaMessage: null,
      fbtraceId: null,
      code: null,
      subcode: null,
      status: 502,
    });
    expect(JSON.stringify(friendlyMetaError(d))).not.toContain('EAAB');
  });
});
