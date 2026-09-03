import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCHEDULED_CRONS } from './services/scheduled-job-isolation.js';

describe('Cron Trigger設定', () => {
  it('Workerが判定するCron式がwrangler.tomlにすべて登録されている', () => {
    const workerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const configuredCronList = wranglerConfig.match(/^crons\s*=\s*(\[[^\n]+\])/m)?.[1];

    expect(configuredCronList).toBeDefined();

    const configuredCrons = new Set<string>(JSON.parse(configuredCronList ?? '[]'));
    expect(workerSource).toContain('scheduledLane(event.cron)');
    expect(configuredCrons).toEqual(new Set(Object.values(SCHEDULED_CRONS)));
  });
});
