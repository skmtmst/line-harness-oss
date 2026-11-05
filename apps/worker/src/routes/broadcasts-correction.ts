import type { Context } from 'hono'
import { getBroadcastById } from '@line-crm/db'
import { BROADCAST_DEFINITION_EDIT_KEY } from '@line-crm/shared'
import { assertChanged, clearAssertions } from '../features/booking/booking-series/index.js'
import { simulationContext } from '../features/broadcasts/simulation-preview.js'
import { broadcastAccountIds, broadcastWriteBoundary, canAccessBroadcast } from './broadcasts-definition.js'
import type { Env } from '../worker-env.js'

/** 送信せず、元配信の送達記録を参照する模擬用の訂正下書きを１件だけ作る。 */
export async function createBroadcastCorrection(c: Context<Env>) {
  const origin = c.req.param('id')!
  const source = await getBroadcastById(c.env.DB, origin)
  if (!source || !await canAccessBroadcast(c.env.DB, c.get('staff'), source)) return c.json({ success: false, error: 'BROADCAST_NOT_FOUND' }, 404)
  const boundary = await broadcastWriteBoundary(c, broadcastAccountIds(source), { operationKey: BROADCAST_DEFINITION_EDIT_KEY })
  if (!boundary.allowed) return c.json({ success: false, error: boundary.reason }, boundary.reason === 'outside-scope' ? 404 : 403)
  const staff = c.get('staff')
  if (!staff || staff.readOnly || c.get('impersonation')) return c.json({ success: false, error: 'forbidden' }, 403)
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key || !/^[-\w:]{1,128}$/.test(key)) return c.json({ success: false, error: 'idempotency_key_required' }, 400)
  const replay = async () => c.env.DB.prepare('SELECT broadcast_id FROM broadcast_sender_corrections WHERE correction_of_broadcast_id=?')
    .bind(origin).first<{ broadcast_id: string }>()
  const old = await replay()
  if (old) return c.json({ success: true, data: { broadcastId: old.broadcast_id, testMode: true }, replayed: true })
  if (source.status !== 'sent' || !source.line_account_id || !['all', 'tag', 'segment'].includes(source.target_type) || await simulationContext(c.env.DB, origin)) return c.json({ success: false, error: 'correction_source_unavailable' }, 409)
  {
    const count = await c.env.DB.prepare(`SELECT COUNT(*) n FROM friends f WHERE f.line_account_id=? AND
      (EXISTS(SELECT 1 FROM broadcast_send_claims c WHERE c.broadcast_id=? AND c.friend_id=f.id AND c.state='sent')
      OR EXISTS(SELECT 1 FROM broadcast_ab_recipients r WHERE r.broadcast_id=? AND r.friend_id=f.id AND r.state='sent'))`)
      .bind(source.line_account_id, origin, origin).first<{ n: number }>()
    if (!count?.n) return c.json({ success: false, error: 'correction_recipients_unavailable' }, 409)
  }
  const id = crypto.randomUUID()
  const content = '先ほどお送りした内容に誤りがありました。お詫びして訂正いたします。'
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id,draft_payload_json)
        SELECT ?,?,'text',?,'all','draft',line_account_id,'{"draftTargetMode":"all"}' FROM broadcasts
        WHERE id=? AND line_account_id=? AND status='sent' AND target_type=? AND NOT EXISTS
          (SELECT 1 FROM broadcast_execution_contexts x WHERE x.broadcast_id=broadcasts.id AND x.execution_mode='simulation')`)
        .bind(id, `訂正：${source.title}`, content, origin, source.line_account_id, source.target_type),
      assertChanged(c.env.DB),
      c.env.DB.prepare(`INSERT INTO broadcast_sender_corrections(broadcast_id,correction_of_broadcast_id,correction_request_key)
        VALUES(?,?,?)`).bind(id, origin, key),
      c.env.DB.prepare(`INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,request_key,request_fingerprint)
        VALUES(?,?,COALESCE((SELECT purpose FROM broadcast_execution_contexts WHERE broadcast_id=?),'marketing'),'manual',?,?,?)`)
        .bind(id, source.line_account_id, origin, staff.id, `correction:${origin}:${key}`, `correction:${origin}`),
      clearAssertions(c.env.DB),
    ])
  } catch (error) {
    const saved = await replay()
    if (saved) return c.json({ success: true, data: { broadcastId: saved.broadcast_id, testMode: true }, replayed: true })
    if (/CHECK constraint/i.test(String(error))) return c.json({ success: false, error: 'correction_source_changed' }, 409)
    throw error
  }
  return c.json({ success: true, data: { broadcastId: id, testMode: true } }, 201)
}
