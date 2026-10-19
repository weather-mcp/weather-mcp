import { describe, it, expect } from 'vitest';
import {
  parseHttpConfig,
  ERR_PORT,
  ERR_PUBLIC_URL_REQUIRED,
  ERR_ISSUER_REQUIRED,
  ERR_PUBLIC_URL_INVALID,
  ERR_ISSUER_INVALID,
  ERR_PUBLIC_URL_HTTPS,
  ERR_ISSUER_HTTPS,
  ERR_PUBLIC_URL_QUERY,
  ERR_ISSUER_QUERY,
  ERR_PUBLIC_URL_PATH,
  ERR_PUBLIC_URL_USERINFO,
  ERR_ISSUER_USERINFO,
} from '../../src/config/http.js';

const S = 'zqhttpcfg7731';
const GOOD = {
  WEATHER_HTTP_PUBLIC_URL: 'https://mcp.example.com/mcp/7f3a-9b2c',
  WEATHER_OAUTH_ISSUER: 'https://auth.example.com/issuer',
};

function run(over: Record<string, string | undefined>) {
  return parseHttpConfig({ ...GOOD, ...over } as NodeJS.ProcessEnv);
}
function refused(over: Record<string, string | undefined>, msg: string) {
  const r = run(over);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toBe(msg);
    expect(r.error).not.toContain(S);
  }
}

describe('parseHttpConfig', () => {
  it('applies defaults', () => {
    const r = run({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.host).toBe('127.0.0.1');
      expect(r.config.port).toBe(3939);
      expect(r.config.requiredScopes).toEqual([]);
      expect(r.config.publicUrl.href).toBe('https://mcp.example.com/mcp/7f3a-9b2c');
      expect(r.config.issuer).toBe('https://auth.example.com/issuer');
      expect(r.config.issuerUrl.hostname).toBe('auth.example.com');
    }
  });

  it('trims and treats empty host/port as default', () => {
    const r = run({ WEATHER_HTTP_HOST: '  ', WEATHER_HTTP_PORT: ' ' });
    expect(r.ok && r.config.host).toBe('127.0.0.1');
    expect(r.ok && r.config.port).toBe(3939);
    const r2 = run({ WEATHER_HTTP_HOST: ' 0.0.0.0 ', WEATHER_HTTP_PORT: ' 8080 ' });
    expect(r2.ok && r2.config.host).toBe('0.0.0.0');
    expect(r2.ok && r2.config.port).toBe(8080);
  });

  it('trims the issuer string', () => {
    const r = run({ WEATHER_OAUTH_ISSUER: '  https://auth.example.com/i  ' });
    expect(r.ok && r.config.issuer).toBe('https://auth.example.com/i');
  });

  it('splits scopes, trims, drops empties', () => {
    const r = run({ WEATHER_OAUTH_REQUIRED_SCOPES: ' a, b ,,c ,' });
    expect(r.ok && r.config.requiredScopes).toEqual(['a', 'b', 'c']);
  });

  it('accepts port bounds', () => {
    expect(run({ WEATHER_HTTP_PORT: '1' }).ok).toBe(true);
    expect(run({ WEATHER_HTTP_PORT: '65535' }).ok).toBe(true);
  });

  it.each(['0', '1.5', '3939abc', '-1', '65536', `${S}`, '0x10', '1e2x'])(
    'refuses port %s',
    (p) => refused({ WEATHER_HTTP_PORT: p }, ERR_PORT)
  );

  it('requires each URL variable', () => {
    refused({ WEATHER_HTTP_PUBLIC_URL: undefined }, ERR_PUBLIC_URL_REQUIRED);
    refused({ WEATHER_HTTP_PUBLIC_URL: '   ' }, ERR_PUBLIC_URL_REQUIRED);
    refused({ WEATHER_OAUTH_ISSUER: undefined }, ERR_ISSUER_REQUIRED);
    refused({ WEATHER_OAUTH_ISSUER: '' }, ERR_ISSUER_REQUIRED);
  });

  it('refuses unparseable URLs', () => {
    refused({ WEATHER_HTTP_PUBLIC_URL: `not a url ${S}` }, ERR_PUBLIC_URL_INVALID);
    refused({ WEATHER_OAUTH_ISSUER: `not a url ${S}` }, ERR_ISSUER_INVALID);
  });

  it('refuses non-http(s) protocols', () => {
    refused({ WEATHER_HTTP_PUBLIC_URL: `ftp://h/${S}` }, ERR_PUBLIC_URL_HTTPS);
    refused({ WEATHER_OAUTH_ISSUER: `ftp://h/${S}` }, ERR_ISSUER_HTTPS);
  });

  it('refuses http on non-loopback hosts', () => {
    refused({ WEATHER_HTTP_PUBLIC_URL: `http://${S}.example.com/mcp` }, ERR_PUBLIC_URL_HTTPS);
    refused({ WEATHER_OAUTH_ISSUER: `http://${S}.example.com/i` }, ERR_ISSUER_HTTPS);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts http public URL on %s', (h) => {
    const r = run({ WEATHER_HTTP_PUBLIC_URL: `http://${h}:3939/mcp` });
    expect(r.ok).toBe(true);
  });

  it.each(['localhost', '127.0.0.1'])('accepts http issuer on %s', (h) => {
    expect(run({ WEATHER_OAUTH_ISSUER: `http://${h}:9000/issuer` }).ok).toBe(true);
  });

  it('refuses http issuer on [::1]', () => {
    refused({ WEATHER_OAUTH_ISSUER: 'http://[::1]/issuer' }, ERR_ISSUER_HTTPS);
  });

  it('refuses a query or fragment on each URL, including bare ? and #', () => {
    for (const suffix of [`?${S}=1`, `#${S}`, '?', '#']) {
      refused({ WEATHER_HTTP_PUBLIC_URL: `https://h.example.com/mcp${suffix}` }, ERR_PUBLIC_URL_QUERY);
      refused({ WEATHER_OAUTH_ISSUER: `https://h.example.com/i${suffix}` }, ERR_ISSUER_QUERY);
    }
  });

  it('accepts a safe path and refuses path-to-regexp syntax', () => {
    expect(run({ WEATHER_HTTP_PUBLIC_URL: 'https://h.example.com/mcp/7f3a-9b2c' }).ok).toBe(true);
    expect(run({ WEATHER_HTTP_PUBLIC_URL: 'https://h.example.com' }).ok).toBe(true);
    for (const p of [`/mcp:v2${S}`, `/mcp(1)${S}`, `/m*${S}`, `/a%20b${S}`, `/a b${S}`]) {
      refused({ WEATHER_HTTP_PUBLIC_URL: `https://h.example.com${p}` }, ERR_PUBLIC_URL_PATH);
    }
  });

  it('refuses userinfo on the public URL', () => {
    refused({ WEATHER_HTTP_PUBLIC_URL: `https://${S}:${S}@h.example.com/mcp` }, ERR_PUBLIC_URL_USERINFO);
    refused({ WEATHER_HTTP_PUBLIC_URL: `https://${S}@h.example.com/mcp` }, ERR_PUBLIC_URL_USERINFO);
  });

  it('refuses userinfo on the issuer', () => {
    refused({ WEATHER_OAUTH_ISSUER: `https://${S}:${S}@auth.example.com/issuer` }, ERR_ISSUER_USERINFO);
    refused({ WEATHER_OAUTH_ISSUER: `https://${S}@auth.example.com/issuer` }, ERR_ISSUER_USERINFO);
  });

  it('reads keys by name only', () => {
    const env = Object.create({ WEATHER_HTTP_PORT: '1234' }) as NodeJS.ProcessEnv;
    Object.assign(env, GOOD);
    // Inherited properties are still found by env[name]; process.env has no prototype keys.
    const r = parseHttpConfig(env);
    expect(r.ok).toBe(true);
  });
});
