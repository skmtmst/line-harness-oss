import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { currentRequestId, withInvocation } from '@line-crm/shared/server';
import { recordAuditEvent } from '../src/access-audit.js';
import { asD1 } from './d1-test-helper.js';

it('同じ依頼の監査にサーバー生成の番号を保存し、秘密の伏せ方を保つ', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    const db = asD1(sqlite);
    let id: string | undefined;
    await withInvocation('http', async () => {
      id = currentRequestId();
      await recordAuditEvent(db, { id: 'trace-fixture', category: 'business', action: 'trace.test',
        requestTraceId: 'customer@example.invalid', after: { token: 'secret-not-for-logs', label: 'customer@example.invalid' } });
    });
    const row = sqlite.prepare('SELECT request_trace_id, after_json FROM audit_events WHERE id=?').get('trace-fixture') as { request_trace_id: string; after_json: string };
    expect(row.request_trace_id).toBe(id);
    expect(row.request_trace_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.after_json).not.toMatch(/secret-not-for-logs|customer@example/);
  } finally { sqlite.close(); }
});
