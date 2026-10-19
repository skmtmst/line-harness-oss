import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { assertWorkerConfig, workerArtifactPath } from './production/artifacts.js';

const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
const candidate = () => JSON.parse(JSON.stringify(source));

describe('production Worker generated artifact safety', () => {
  it('derives the Vite artifact path from the canonical worker name, including renames', () => {
    expect(workerArtifactPath(source.name)).toBe(`apps/worker/dist/${source.name.replaceAll('-', '_')}/wrangler.json`);
    expect(workerArtifactPath('new-worker')).toBe('apps/worker/dist/new_worker/wrangler.json');
    expect(() => workerArtifactPath('../escape')).toThrow();
  });
  it('accepts the existing production settings without changing workers_dev', () => {
    expect(() => assertWorkerConfig(source, candidate())).not.toThrow();
    const reordered = candidate(); reordered.routes = reordered.routes.map((route: Record<string, unknown>) => Object.fromEntries(Object.entries(route).reverse()));
    expect(() => assertWorkerConfig(source, reordered)).not.toThrow();
    expect(source.workers_dev).toBe(true);
  });
  it.each(['workers_dev', 'preview_urls', 'routes', 'name'])('rejects generated %s drift', key => {
    const built = candidate();
    built[key] = key === 'routes' ? [{ pattern: 'unexpected.invalid', custom_domain: true }] : key === 'name' ? 'wrong' : false;
    expect(() => assertWorkerConfig(source, built)).toThrow();
  });
  it.each(['nodejs_compat', 'global_fetch_strictly_public'])('rejects a missing %s flag', flag => {
    const built = candidate();
    built.compatibility_flags = built.compatibility_flags.filter((value: string) => value !== flag);
    expect(() => assertWorkerConfig(source, built)).toThrow();
  });
  it.each([['d1_databases', 'database_name'], ['d1_databases', 'database_id'], ['r2_buckets', 'bucket_name']])('rejects a wrong production %s %s', (collection, field) => {
    const built = candidate();
    built[collection][0][field] = 'staging';
    expect(() => assertWorkerConfig(source, built)).toThrow();
  });
  it('rejects extra/missing bindings and deploys only the verified generated config', () => {
    for (const collection of ['d1_databases', 'r2_buckets']) {
      const built = candidate();
      built[collection].push({ ...built[collection][0], binding: 'UNEXPECTED' });
      expect(() => assertWorkerConfig(source, built)).toThrow();
    }
    const workflow = readFileSync('.github/workflows/deploy-cloudflare-worker.yml', 'utf8');
    expect(workflow).toContain('production/run.ts deploy-worker');
    expect(workflow.indexOf('production/run.ts worker-artifact')).toBeLessThan(workflow.indexOf('production/run.ts deploy-worker'));
  });
});
