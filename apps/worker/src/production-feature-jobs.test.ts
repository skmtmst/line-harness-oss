import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from './test-utils/d1-sqlite.js';
import type { Env } from './worker-env.js';

const fixture = vi.hoisted(() => ({ jobs: [] as string[] }));
vi.mock('./services/scheduled-job-isolation.js', async importOriginal => ({
  ...await importOriginal<typeof import('./services/scheduled-job-isolation.js')>(),
  // 他の定期処理は動かさず、実際のscheduledが組み立てた処理の名前を調べる。
  runIsolatedScheduledJobs: vi.fn(async (jobs: { name: string }[]) => {
    fixture.jobs.push(...jobs.map(job => job.name));
    return { succeeded: jobs.length, failed: 0 };
  }),
}));
const { default: worker } = await import('./index.js');
const { SCHEDULED_CRONS } = await import('./services/scheduled-job-isolation.js');
afterEach(() => { fixture.jobs = []; });

describe('Googleの定期読み取りも飲食店の試験旗から独立', () => {
  it.each(['production', 'staging'] as const)('%s の実設定で必要な処理だけを登録する', async environment => {
    const { unstable_readConfig } = await import('wrangler');
    const config = unstable_readConfig({ config: fileURLToPath(new URL(environment === 'production' ? '../wrangler.toml' : '../wrangler.staging.toml', import.meta.url)) });
    const db = createTestD1();
    const env = { ...config.vars, DB: db.db } as Env['Bindings'];
    try {
      const tick = async (cron: string) => {
        await worker.scheduled!({ cron, scheduledTime: Date.parse('2026-10-17T00:01:00Z') } as ScheduledEvent, env, {} as ExecutionContext);
      };
      await tick(SCHEDULED_CRONS.frequentHeavy);
      await tick(SCHEDULED_CRONS.sixHourlyHeavy);
      for (const name of ['google business resync', 'google business metrics', 'google business token keepalive']) expect(fixture.jobs).toContain(name);
      for (const name of ['restaurant hold expiry', 'restaurant raw mail retention']) expect(fixture.jobs.includes(name)).toBe(environment === 'staging');
      fixture.jobs = [];
      env.GOOGLE_BUSINESS_ENABLED = 'false';
      await tick(SCHEDULED_CRONS.frequentHeavy);
      await tick(SCHEDULED_CRONS.sixHourlyHeavy);
      expect(fixture.jobs).not.toContain('google business resync');
      expect(fixture.jobs).not.toContain('google business metrics');
      expect(fixture.jobs).not.toContain('google business token keepalive');
      // 保存期限を守る掃除は、スイッチを切っても続ける。
      expect(fixture.jobs).toContain('google business content retention');
    } finally { db.raw.close(); }
  });
});
