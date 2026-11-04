import { expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';

vi.mock('@line-crm/db', async (original) => ({ ...await original<typeof import('@line-crm/db')>(), getLineAccounts: async () => [] }));
vi.mock('../middleware/sensitive-rate-limit.js', () => ({ pruneSensitiveRateLimits: async () => {} }));
vi.mock('../features/auto-replies/auto-reply-delivery/index.js', () => ({ processAutoReplyDeliveries: async () => {} }));
vi.mock('../services/scheduled-job-isolation.js', () => ({ runIsolatedScheduledJobs: async (jobs: Array<{name:string;run:()=>Promise<void>}>) => {
  const cleanup=jobs.find(job=>job.name==='expired media send claims');
  if (cleanup) await cleanup.run();
} }));

test('定期処理は期限切れの確認中だけを回収する', async () => {
  const fixture=createTestD1({foreignKeys:false});
  try {
    fixture.raw.exec(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,lease_expires_at,created_at,updated_at)
      VALUES ('expired','a','[]','checking','2026-01-01T00:00:00.000Z','2026-01-01','2026-01-01'),
             ('deleting','a','[]','deleting','2026-01-01T00:00:00.000Z','2026-01-01','2026-01-01')`);
    const {runFrequentHeavyJobs}=await import('./frequent.js');
    await runFrequentHeavyJobs({scheduledTime:Date.parse('2026-01-02T00:00:00Z')} as ScheduledEvent,
      {DB:fixture.db,LINE_CHANNEL_ACCESS_TOKEN:'test'} as Env['Bindings']);
    expect(fixture.raw.prepare('SELECT media_id FROM media_deletion_jobs').all()).toEqual([{media_id:'deleting'}]);
  } finally {fixture.raw.close();}
});
