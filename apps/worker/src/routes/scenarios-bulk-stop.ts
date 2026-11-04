import { jstNow } from '@line-crm/db';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

type StopItem = { id: string; revision: number };
type ScenarioState = { id: string; line_account_id: string | null; content_revision: number; is_active: number };

/** 最大50件を1文で照合し、どれかが違えばbatch全体を戻す。 */
export async function bulkStopScenarios(c: Context<Env>) {
  const body = await c.req.json<{ items?: unknown }>().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 || items.some(item =>
    !item || typeof item.id !== 'string' || !item.id || !Number.isSafeInteger(item.revision) || item.revision < 1
  ) || new Set(items.map(item => item.id)).size !== items.length) {
    return c.json({ success: false, error: '停止するシナリオと版を50件以内で指定してください' }, 400);
  }
  const targets = items as StopItem[];
  const db = c.env.DB;
  const ids = JSON.stringify(targets.map(item => item.id));
  const states = async () => (await db.prepare(
    'SELECT id,line_account_id,content_revision,is_active FROM scenarios WHERE id IN (SELECT value FROM json_each(?))',
  ).bind(ids).all<ScenarioState>()).results;
  const visibleRows = async (rows: ScenarioState[]) => {
    const scope = await getVisibleLineAccountScope(db, c.get('staff'));
    const accounts = new Set(scope.allowedAccountIds);
    return rows.filter(row => row.line_account_id === null ? scope.canSeeUnassigned : accounts.has(row.line_account_id));
  };
  const initial = await states();
  if ((await visibleRows(initial)).length !== targets.length || initial.length !== targets.length) {
    return c.json({ success: false, error: 'シナリオの状態が変わりました。読み直してください', current: [] }, 409);
  }
  const conflict = async () => {
    const rows = await states();
    const visible = await visibleRows(rows);
    return c.json({ success: false, error: 'シナリオの状態が変わりました。読み直してください', current: visible.map(row => ({ id: row.id, contentRevision: row.content_revision, isActive: !!row.is_active })) }, 409);
  };
  const confirmedTargets = targets.map(item => ({ ...item, accountId: initial.find(row => row.id === item.id)!.line_account_id }));
  const now = jstNow();
  try {
    await db.batch([
      db.prepare(`UPDATE scenarios SET is_active=0,content_revision=content_revision+1,
        stopped_reason=NULL,stopped_by=?,stopped_at=?,updated_at=?
        WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND is_active=1
          AND EXISTS (SELECT 1 FROM json_each(?) item WHERE json_extract(item.value,'$.id')=scenarios.id
            AND json_extract(item.value,'$.revision')=scenarios.content_revision
            AND json_extract(item.value,'$.accountId') IS scenarios.line_account_id)`)
        .bind(c.get('staff')!.id, now, now, JSON.stringify(confirmedTargets), JSON.stringify(confirmedTargets)),
      db.prepare("SELECT json(CASE WHEN changes()=? THEN '{}' ELSE 'SCENARIO_STOP_CONFLICT' END)").bind(targets.length),
    ]);
  } catch (error) {
    if (/malformed JSON/i.test(String(error))) return conflict();
    throw error;
  }
  return c.json({ success: true, data: { stopped: targets.length } });
}
