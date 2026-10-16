import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The browser runner shares this native JavaScript module.
import { assertReportingPolicy, securityHeaders } from './csp-policy.mjs';

describe('B-351 production static policies', () => {
  for (const target of ['web', 'liff']) it(`${target}: keeps resource policy report-only without hiding inline findings`, () => {
    const source = readFileSync(`apps/${target}/public/_headers`, 'utf8');
    const headers = securityHeaders(source);
    expect(() => assertReportingPolicy(headers, target)).not.toThrow();
    const report = headers['content-security-policy-report-only'];
    for (const bad of [undefined, report.replace('https://static.line-scdn.net', ''), report.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), report.replace("script-src-attr 'none';", '')]) {
      expect(() => assertReportingPolicy({ ...headers, 'content-security-policy-report-only': bad }, target)).toThrow();
    }
    expect(() => securityHeaders(source.replace('/*', '/preview/*'))).toThrow();
    expect(() => assertReportingPolicy({ ...headers, 'content-security-policy': report }, target)).toThrow();
  });
});
