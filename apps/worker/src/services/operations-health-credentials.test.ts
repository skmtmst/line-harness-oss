import { afterEach, expect, test, vi } from 'vitest';
import { updateLineAccount } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
const quota = vi.hoisted(() => vi.fn(async (_token: string) => ({limit:1000,used:10})));
vi.mock('../features/broadcasts/broadcast-quota-guard/index.js', () => ({fetchQuota:quota}));
import { runOperationHealthChecks } from './operations-health.js';
afterEach(() => { vi.clearAllMocks(); });
test('health checks use the encrypted credential when the retired legacy column is empty', async () => {
  const fixture = createTestD1(), credentialEncryptionKey = btoa('q'.repeat(32));
  try {
    fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','legacy','secret')").run();
    await updateLineAccount(fixture.db,'a',{channel_access_token:'current-fixture-token'},credentialEncryptionKey);
    fixture.raw.prepare("UPDATE line_accounts SET channel_access_token='' WHERE id='a'").run();
    const result = await runOperationHealthChecks(fixture.db,{lineAccountId:'a',source:'scheduled',deps:{credentialEncryptionKey}});
    expect(result.run.status).toBe('completed');
    expect(quota).toHaveBeenCalledExactlyOnceWith('current-fixture-token');
    expect(JSON.stringify(result)).not.toContain('current-fixture-token');
  } finally { fixture.raw.close(); }
});
