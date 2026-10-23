import { afterEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { WorkerBindings } from '../worker-bindings.js';
const observed = vi.hoisted(() => ({jobs:[] as import('../services/scheduled-job-isolation.js').ScheduledJob[],credentials:vi.fn()}));
vi.mock('@line-crm/db', async original => ({...await original<typeof import('@line-crm/db')>(),getLineAccounts:observed.credentials}));
vi.mock('../services/scheduled-job-isolation.js', async original => ({
  ...await original<typeof import('../services/scheduled-job-isolation.js')>(),
  runIsolatedScheduledJobs:async (jobs:import('../services/scheduled-job-isolation.js').ScheduledJob[]) => { observed.jobs=jobs; },
}));
import { runFrequentHeavyJobs } from './frequent.js';
afterEach(() => { vi.restoreAllMocks(); });
test('a broken credential does not prevent unrelated heavy jobs from being registered or executed', async () => {
  const fixture = createTestD1();
  observed.credentials.mockRejectedValue(new Error('fixture credential unavailable'));
  try {
    await runFrequentHeavyJobs({cron:'1-56/5 * * * *',scheduledTime:Date.parse('2026-10-23T00:06:00Z')} as ScheduledEvent,
      {DB:fixture.db,LINE_CHANNEL_ACCESS_TOKEN:'fixture'} as WorkerBindings);
    expect(observed.credentials).not.toHaveBeenCalled();
    expect(observed.jobs.some(job=>job.name==='analytics projection')).toBe(true);
    await observed.jobs.find(job=>job.name==='friend snapshot')!.run();
    await expect(observed.jobs.find(job=>job.name==='broadcast insights')!.run()).rejects.toThrow('fixture credential unavailable');
  } finally { fixture.raw.close(); }
});
