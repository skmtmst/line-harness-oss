import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Cron Trigger設定', () => {
  it('Workerが判定するCron式がwrangler.tomlにすべて登録されている', () => {
    const workerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const configuredCronList = wranglerConfig.match(/^crons\s*=\s*(\[[^\n]+\])/m)?.[1];

    expect(configuredCronList).toBeDefined();

    const configuredCrons = new Set<string>(JSON.parse(configuredCronList ?? '[]'));
    const guardedCrons = new Set(
      [...workerSource.matchAll(/event\.cron\s*===\s*'([^']+)'/g)].map((match) => match[1]),
    );
    const missingCrons = [...guardedCrons].filter((cron) => !configuredCrons.has(cron));

    expect(missingCrons).toEqual([]);
  });
});
