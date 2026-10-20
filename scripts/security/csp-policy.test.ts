import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The browser runner shares this native JavaScript module.
import { assertEnforcedPolicy, securityHeaders } from './csp-policy.mjs';

describe('production static policies', () => {
  for (const target of ['web', 'liff']) it(`${target}: enforces the script boundary without unsafe script sources`, () => {
    const source = readFileSync(`apps/${target}/public/_headers`, 'utf8');
    const headers = securityHeaders(source);
    expect(() => assertEnforcedPolicy(headers, target)).not.toThrow();
    const report = headers['content-security-policy'];
    for (const bad of [undefined, report.replace('https://static.line-scdn.net', ''), report.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), report.replace("script-src-attr 'none';", '')]) {
      expect(() => assertEnforcedPolicy({ ...headers, 'content-security-policy': bad }, target)).toThrow();
    }
    expect(() => securityHeaders(source.replace('/*', '/preview/*'))).toThrow();
    expect(() => assertEnforcedPolicy({ ...headers, 'content-security-policy': undefined, 'content-security-policy-report-only': report }, target)).toThrow();
  });
});
