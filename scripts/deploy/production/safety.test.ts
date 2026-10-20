import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertProductionApproval, assertReleaseSource, assertStagingRun } from './preflight.js';
import { assertBootstrap, assertHeaderRules, headerRules } from './artifacts.js';
import { assertApproved, assertUnchanged } from './database.js';
import { assertBackupPolicy, decryptBackup, encryptBackup } from './backup.js';
import { assertResponse } from './responses.js';

const sha = 'a'.repeat(40), repository = 'owner/repository';
const context = { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/deploy-cloudflare-production.yml@refs/heads/main` };
const run = { repository: { full_name: repository }, head_repository: { full_name: repository }, path: '.github/workflows/deploy-cloudflare-staging.yml', head_sha: sha, status: 'completed', conclusion: 'success', event: 'workflow_dispatch' };
const jobs = { jobs: [{ conclusion: 'success', steps: [{ name: 'Verify public source revisions', conclusion: 'success' }] }] };

describe('approved production source and staging proof', () => {
  it('requires the full current main revision and the authorized parent', () => {
    expect(() => assertReleaseSource(sha, sha, sha, context)).not.toThrow();
    const mergedMain = 'b'.repeat(40);
    expect(() => assertReleaseSource(sha, mergedMain, sha, { ...context, GITHUB_SHA: mergedMain }, true)).not.toThrow();
    expect(() => assertReleaseSource(sha, mergedMain, sha, { ...context, GITHUB_SHA: mergedMain })).toThrow();
    for (const [candidate, main, actual, env] of [[sha.slice(0, 12), sha, sha, context], [sha, 'b'.repeat(40), sha, context], [sha, sha, 'b'.repeat(40), context], [sha, sha, sha, { ...context, GITHUB_REF: 'refs/heads/feature' }], [sha, sha, sha, { ...context, GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/main` }]] as const) expect(() => assertReleaseSource(candidate, main, actual, env)).toThrow();
  });
  it('does not accept a staging dry-run/replay, old SHA, foreign repo or failed public verification', () => {
    expect(() => assertStagingRun(run, jobs, sha, repository)).not.toThrow();
    for (const mutation of [{ head_sha: 'b'.repeat(40) }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'attacker/fork' } }]) expect(() => assertStagingRun({ ...run, ...mutation }, jobs, sha, repository)).toThrow();
    expect(() => assertStagingRun(run, { jobs: [{ conclusion: 'success', steps: [] }] }, sha, repository)).toThrow();
    expect(() => assertStagingRun(run, { jobs: [{ conclusion: 'success', steps: [{ ...jobs.jobs[0].steps[0], conclusion: 'skipped' }] }] }, sha, repository)).toThrow();
  });
  it('fails closed if the environment has no actual approval reviewers', () => {
    expect(() => assertProductionApproval({ protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] })).not.toThrow();
    for (const environment of [{}, { protection_rules: [] }, { protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }]) expect(() => assertProductionApproval(environment)).toThrow();
  });
});
describe('approved SQL and backup boundaries', () => {
  const migrations = [{ name: '999_example.sql', sha256: 'c'.repeat(64) }];
  it('requires every pending file, checksum and order; no migration is an explicit empty plan', () => {
    expect(() => assertApproved(migrations, migrations)).not.toThrow();
    expect(() => assertApproved(migrations, [{ sha256: migrations[0].sha256, name: migrations[0].name }])).not.toThrow();
    expect(() => assertApproved([], [])).not.toThrow();
    for (const wrong of [[], [{ ...migrations[0], sha256: 'd'.repeat(64) }], [...migrations, ...migrations], null]) expect(() => assertApproved(migrations, wrong)).toThrow();
    expect(() => assertUnchanged({ pending: migrations, ledgerExists: false }, { pending: migrations, ledgerExists: true })).toThrow();
  });
  const policy = { bucket: 'private-backups', prefix: 'approved/', retentionDays: 7, approval: 'owner-decision' };
  const lifecycle = { rules: [{ enabled: true, conditions: { prefix: 'approved/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 7 * 86400 } } }] };
  it('requires private storage, owner-defined retention, and a bucket outside live bindings', () => {
    const check = (p = policy, managed: unknown = { enabled: false }, custom: unknown = { domains: [] }, rules: unknown = lifecycle, live = ['images']) => assertBackupPolicy(p, managed, custom, rules, live);
    expect(() => check()).not.toThrow();
    for (const bad of [() => check({ ...policy, approval: '' }), () => check(policy, { enabled: true }), () => check(policy, {}, {}), () => check(policy, { enabled: false }, { domains: [{ enabled: true }] }), () => check(policy, undefined, undefined, { rules: [] }), () => check(policy, undefined, undefined, lifecycle, [policy.bucket]), () => check({ ...policy, retentionDays: 8 })]) expect(bad).toThrow();
  });
  it('authenticates encrypted exports; tamper, truncation and wrong keys cannot pass readback', () => {
    const key = Buffer.alloc(32, 9), plain = Buffer.from('synthetic SQL and bookmark');
    const encrypted = encryptBackup(plain, key);
    expect(encrypted.includes(plain)).toBe(false);
    expect(decryptBackup(encrypted, key)).toEqual(plain);
    const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBackup(tampered, key)).toThrow();
    expect(() => decryptBackup(encrypted, Buffer.alloc(32, 8))).toThrow();
    expect(() => decryptBackup(encrypted.subarray(0, 31), key)).toThrow();
  });
});
describe('build and public response headers follow each response kind', () => {
  it('requires every local script file and rejects executable inline scripts, preserving inert JSON', () => {
    const html = '<script src="/_next/static/a.js"></script><script type="application/json">{}</script>';
    expect(() => assertBootstrap(html, file => file === '/_next/static/a.js')).not.toThrow();
    expect(() => assertBootstrap(html, () => false)).toThrow();
    expect(() => assertBootstrap('<script>window.test=1</script>', () => true)).toThrow();
  });
  for (const kind of ['admin', 'worker'] as const) {
    const source = readFileSync(kind === 'admin' ? 'apps/web/public/_headers' : 'apps/worker/public/_headers', 'utf8');
    it(`${kind}: keeps every required header and enforced CSP`, () => {
      expect(() => assertHeaderRules(source, source, kind)).not.toThrow();
      for (const line of source.split('\n').filter(line => /^  [A-Za-z-]+:/.test(line))) expect(() => assertHeaderRules(source, source.replace(line, ''), kind)).toThrow();
      expect(() => assertHeaderRules(source, source.replace("object-src 'none'", "object-src *"), kind)).toThrow();
    });
  }
  it('requires Pages security headers on JSON and 404 too, without applying LIFF framing rules', () => {
    const source = readFileSync('apps/web/public/_headers', 'utf8');
    for (const [kind, status, type] of [['admin-json', 200, 'application/json'], ['admin-error', 404, 'text/html'], ['admin-static', 200, 'application/javascript']] as const) {
      const headers = new Headers(Object.fromEntries(headerRules(source))); headers.set('Content-Type', type);
      expect(() => assertResponse(new Response('synthetic', { status, headers }), kind, status, source)).not.toThrow();
      headers.delete('Content-Security-Policy');
      expect(() => assertResponse(new Response('synthetic', { status, headers }), kind, status, source)).toThrow();
    }
  });
  it('checks JSON and 401/403/404/500 errors without imposing HTML CSP or leaking body/cookies', () => {
    const headers = { 'Content-Type': 'application/json', 'X-Request-ID': 'synthetic-request', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
    expect(() => assertResponse(new Response('{}', { headers }), 'json', 200)).not.toThrow();
    for (const status of [401, 403, 404, 500]) {
      expect(() => assertResponse(new Response('synthetic body', { status, headers }), 'error', status)).not.toThrow();
      for (const missing of ['X-Request-ID', 'X-Robots-Tag', 'Cache-Control']) {
        const bad = new Headers(headers); bad.delete(missing);
        expect(() => assertResponse(new Response('{}', { status, headers: bad }), 'error', status)).toThrow();
      }
    }
  });
});
