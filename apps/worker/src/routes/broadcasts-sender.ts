import type { Context } from 'hono'
import { getBroadcastById } from '@line-crm/db'
import { BROADCAST_DEFINITION_EDIT_KEY } from '@line-crm/shared'
import { assertChanged, clearAssertions } from '../features/booking/booking-series/index.js'
import { resolveLineSender } from '../services/line-senders.js'
import { GapError } from '../services/gap-common.js'
import { simulationContext } from '../features/broadcasts/broadcast-simulation/index.js'
import type { Env } from '../worker-env.js'
import { broadcastAccountIds, broadcastWriteBoundary, canAccessBroadcast } from './broadcasts-definition.js'

/** 送り手の控えは配信と同じ店の範囲で読み、下書きの版と一緒に変更する。 */
export async function getBroadcastSender(c: Context<Env>) {
  const id = c.req.param('id')!
  const row = await getBroadcastById(c.env.DB, id)
  if (!row || !await canAccessBroadcast(c.env.DB, c.get('staff'), row)) return c.json({ success: false, error: 'BROADCAST_NOT_FOUND' }, 404)
  const saved = await c.env.DB.prepare('SELECT sender_id, sender_snapshot_json, sent_by_staff_id, sent_by_staff_name, correction_of_broadcast_id FROM broadcast_sender_corrections WHERE broadcast_id=?')
    .bind(id).first<{ sender_id: string | null; sender_snapshot_json: string | null; sent_by_staff_id: string | null; sent_by_staff_name: string | null; correction_of_broadcast_id: string | null }>()
  return c.json({ success: true, data: { senderId: saved?.sender_id ?? null, sender: saved?.sender_snapshot_json ? JSON.parse(saved.sender_snapshot_json) : null,
    sentByStaffId: saved?.sent_by_staff_id ?? null, sentByStaffName: saved?.sent_by_staff_name ?? null, correctionOfBroadcastId: saved?.correction_of_broadcast_id ?? null, version: row.lock_version, testMode: Boolean(await simulationContext(c.env.DB,id)) } })
}

/** 実送信はしない。送り手の変更は保存版を進め、古い確認を無効にする。 */
export async function putBroadcastSender(c: Context<Env>) {
  const id = c.req.param('id')!
  const row = await getBroadcastById(c.env.DB, id)
  if (!row || !await canAccessBroadcast(c.env.DB, c.get('staff'), row)) return c.json({ success: false, error: 'BROADCAST_NOT_FOUND' }, 404)
  const boundary = await broadcastWriteBoundary(c, broadcastAccountIds(row), { operationKey: BROADCAST_DEFINITION_EDIT_KEY })
  if (!boundary.allowed) return c.json({ success: false, error: boundary.reason }, boundary.reason === 'outside-scope' ? 404 : 403)
  const staff = c.get('staff')
  if (!staff || staff.readOnly || c.get('impersonation')) return c.json({ success: false, error: 'forbidden' }, 403)
  if (!await simulationContext(c.env.DB,id)) return c.json({ success: false, error: 'simulation_required' }, 409)
  const body = await c.req.json().catch(() => null) as { senderId?: unknown; expectedVersion?: unknown } | null
  if (!body || !(body.senderId === null || typeof body.senderId === 'string' && body.senderId.length > 0)
    || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return c.json({ success: false, error: 'invalid_sender_request' }, 400)
  const account = (row as unknown as { line_account_id: string | null }).line_account_id
  if (!account || row.target_type === 'multi-account-dedup') return c.json({ success: false, error: 'sender_account_required' }, 409)
  const senderId = body.senderId as string | null
  if (senderId) {
    try { await resolveLineSender(c.env.DB, account, staff, senderId) }
    catch (error) { if (error instanceof GapError) return c.json({ success: false, error: error.code }, error.status); throw error }
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE broadcasts SET lock_version=lock_version+1, approval_status='none'
        WHERE id=? AND line_account_id=? AND status='draft' AND lock_version=? AND (? IS NULL OR EXISTS (
          SELECT 1 FROM line_senders WHERE id=? AND account_id=? AND status='active'
          AND (visibility='all' OR owner_staff_id=? OR ? IN ('owner','admin'))))`)
        .bind(id, account, body.expectedVersion, senderId, senderId, account, staff.id, staff.role),
      assertChanged(c.env.DB),
      c.env.DB.prepare(`INSERT INTO broadcast_sender_corrections(broadcast_id,sender_id,sender_snapshot_json)
        VALUES(?,?,CASE WHEN ? IS NULL THEN NULL ELSE json_object('name',(SELECT name FROM line_senders WHERE id=? AND account_id=?)) END)
        ON CONFLICT(broadcast_id) DO UPDATE SET sender_id=excluded.sender_id,sender_snapshot_json=excluded.sender_snapshot_json`)
        .bind(id, senderId, senderId, senderId, account),
      clearAssertions(c.env.DB),
    ])
  } catch (error) {
    if (/CHECK constraint|constraint failed/i.test(String(error))) return c.json({ success: false, error: 'version_or_sender_changed' }, 409)
    throw error
  }
  return c.json({ success: true, data: { version: Number(body.expectedVersion) + 1 } })
}
