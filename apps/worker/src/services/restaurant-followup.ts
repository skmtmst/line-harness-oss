import { reservationInstant } from '@line-crm/shared';
import { parseScenarioVersionSteps, type ScenarioVersion } from '@line-crm/db';
import type { RestaurantEvent } from './restaurant-events.js';
export interface FollowupTemplate {
    store_id: string;
    scenario_id: string;
    template_version: number;
    sending_status: string;
    approved_version_id: string | null;
    approval_id: string | null;
}
export interface FollowupBinding {
    trigger: string;
    step_id: string;
    offset_minutes: number;
    enabled: number;
    version: number;
}
/** この店・公開版・起点の版を承認payloadへ固定。本文は共通編集だけに置く。 */
export async function requestRestaurantFollowupApproval(db: D1Database, storeId: string, expectedVersion: number, staffId: string) {
    const t = await db.prepare(`SELECT t.*,s.line_account_id,s.organization_id,sc.current_published_version_id
  FROM rt_store_followup_templates t JOIN rt_stores s ON s.id=t.store_id
  JOIN scenarios sc ON sc.id=t.scenario_id AND sc.line_account_id=s.line_account_id WHERE t.store_id=?`)
        .bind(storeId).first<FollowupTemplate & {
        line_account_id: string;
        organization_id: string;
        current_published_version_id: string | null;
    }>();
    if (!t || t.template_version !== expectedVersion)
        return null;
    const v = await db.prepare("SELECT * FROM scenario_versions WHERE id=? AND scenario_id=? AND status='published'")
        .bind(t.current_published_version_id, t.scenario_id).first<ScenarioVersion>();
    if (!v)
        return null;
    const bindings = (await db.prepare('SELECT * FROM rt_store_followup_step_bindings WHERE store_id=? ORDER BY trigger,step_id').bind(storeId).all<FollowupBinding>()).results;
    const steps = parseScenarioVersionSteps(v);
    if (bindings.filter(b => b.enabled && b.trigger === 'waitlist_invited').length > 1)
        return null;
    if (!bindings.some(b => b.enabled) || bindings.some(b => b.enabled && !steps.some(s => s.live_step_id === b.step_id && !s.is_draft)))
        return null;
    // 起点で送るため、購読の質問・分岐や行うことはこの送り方では使用しない。
    if (steps.some(s => bindings.some(b => b.enabled && b.step_id === s.live_step_id) && (s.question_json || s.condition_type || s.target_condition_json || s.on_reach_tag_id)) || JSON.parse(v.actions_snapshot).length)
        return null;
    const payload = JSON.stringify({ operation: 'start_restaurant_followup', templateVersion: t.template_version,
        scenarioVersionId: v.id, lineAccountId: t.line_account_id, bindings });
    const id = crypto.randomUUID();
    await db.batch([
        db.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json,requested_by)
   SELECT ?,?,?,'line_message','LINE来店フォローの本送信を開始','pending',?,?
   WHERE EXISTS(SELECT 1 FROM rt_store_followup_templates t JOIN scenarios s ON s.id=t.scenario_id WHERE t.store_id=? AND t.template_version=? AND s.current_published_version_id=?)`)
            .bind(id, t.organization_id, storeId, payload, staffId, storeId, expectedVersion, v.id),
        db.prepare(`UPDATE rt_store_followup_templates SET sending_status='pending',approval_id=?,approved_version_id=?
   WHERE store_id=? AND template_version=? AND EXISTS(SELECT 1 FROM rt_approval_requests WHERE id=?)`)
            .bind(id, v.id, storeId, expectedVersion, id),
    ]);
    return await db.prepare('SELECT id FROM rt_approval_requests WHERE id=?').bind(id).first<{
        id: string;
    }>();
}
/** 保存済みのできごとから起点に合う行だけを予約ごとの共通ジョブへ渡す。 */
export async function scheduleRestaurantFollowup(db: D1Database, e: RestaurantEvent) {
    const data = JSON.parse(e.payload_json) as {
        scheduleChanged?: boolean;
        startsAt?: string;
        endsAt?: string;
        guestCount?: number;
        waitlistId?: string;
    };
    if (e.reservation_id && e.event_type === 'restaurant.reservation.changed' && !data.scheduleChanged) {
        const prior = await db.prepare('SELECT payload_json FROM rt_reservation_events WHERE reservation_id=? AND reservation_version<? ORDER BY reservation_version DESC LIMIT 1').bind(e.reservation_id, e.reservation_version).first<{
            payload_json: string;
        }>();
        if (prior) {
            const before = JSON.parse(prior.payload_json) as typeof data;
            data.scheduleChanged = instantMs(before.startsAt!) !== instantMs(data.startsAt!) || instantMs(before.endsAt!) !== instantMs(data.endsAt!) || before.guestCount !== data.guestCount;
        }
    }
    if (e.reservation_id) {
        if (e.event_type === 'restaurant.reservation.cancelled' || e.event_type === 'restaurant.departure_undone')
            await db.prepare("UPDATE scenario_source_jobs SET status='cancelled' WHERE source_kind='restaurant_reservation' AND source_id=? AND status IN('pending','failed')").bind(e.reservation_id).run();
        if (e.event_type === 'restaurant.reservation.changed' && data.scheduleChanged)
            await db.prepare("UPDATE scenario_source_jobs SET status='cancelled' WHERE source_kind='restaurant_reservation' AND source_id=? AND source_version<? AND status IN('pending','failed')").bind(e.reservation_id, e.reservation_version).run();
    }
    if (!e.line_account_id || !e.friend_id)
        return;
    const t = await db.prepare(`SELECT t.*,v.* FROM rt_store_followup_templates t JOIN rt_stores s ON s.id=t.store_id
  JOIN scenarios sc ON sc.id=t.scenario_id AND sc.line_account_id=s.line_account_id AND sc.current_published_version_id=t.approved_version_id
  JOIN scenario_versions v ON v.id=t.approved_version_id AND v.status='published'
  JOIN rt_approval_requests a ON a.id=t.approval_id AND a.status='approved'
  WHERE t.store_id=? AND s.line_account_id=? AND t.sending_status='active' AND s.status='active'
  AND json_extract(a.payload_json,'$.templateVersion')=t.template_version`)
        .bind(e.store_id, e.line_account_id).first<FollowupTemplate & ScenarioVersion>();
    if (!t)
        return;
    const reservation = e.reservation_id ? await db.prepare('SELECT * FROM rt_reservations WHERE id=? AND store_id=?').bind(e.reservation_id, e.store_id).first<{
        customer_version: number;
        starts_at: string;
        status: string;
        departed_at: string | null;
    }>() : null;
    // 遅れた旧イベントで新しい時刻のジョブを作らない。
    if (reservation && e.reservation_version !== reservation.customer_version && e.event_type !== 'restaurant.reservation.created')
        return;
    const triggers: string[] = [];
    if (e.event_type === 'restaurant.reservation.created')
        triggers.push('reservation_created');
    if (reservation?.status === 'confirmed' && (e.event_type === 'restaurant.reservation.created' || (e.event_type === 'restaurant.reservation.changed' && data.scheduleChanged)))
        triggers.push('reservation_24h', 'reservation_2h');
    if (e.event_type === 'restaurant.departed' && reservation?.departed_at)
        triggers.push('post_visit', 'review_request');
    if (e.event_type === 'restaurant.waitlist.invited')
        triggers.push('waitlist_invited');
    const bindings = (await db.prepare('SELECT * FROM rt_store_followup_step_bindings WHERE store_id=? AND enabled=1').bind(e.store_id).all<FollowupBinding>()).results;
    for (const b of bindings.filter(b => triggers.includes(b.trigger))) {
        const step = parseScenarioVersionSteps(t).find(s => s.live_step_id === b.step_id && !s.is_draft);
        if (!step)
            continue;
        const sourceId = e.reservation_id ?? data.waitlistId;
        if (!sourceId)
            continue;
        const base = b.trigger.startsWith('reservation_') && b.trigger !== 'reservation_created' ? reservation?.starts_at :
            ['post_visit', 'review_request'].includes(b.trigger) ? reservation?.departed_at : e.occurred_at;
        if (!base)
            continue;
        const at = new Date(instantMs(base) + b.offset_minutes * 60000);
        if (!Number.isFinite(at.getTime()))
            continue;
        if (['reservation_24h', 'reservation_2h'].includes(b.trigger) && at.getTime() < Date.now())
            continue;
        // 既存の確定通知が受理済みなら共通の予約入りで重ねて送らない。
        if (b.trigger === 'reservation_created' && await db.prepare('SELECT 1 FROM rt_customer_notice_outbox WHERE reservation_id=? AND customer_version=? AND sent_at IS NOT NULL').bind(sourceId, e.reservation_version).first())
            continue;
        // 応答喪失の仕事を別の公開版・retry keyで作り直すと二重送信になる。
        // 一度でも試した同じ起点・同じ行は、元の仕事だけで回収する。
        if (await db.prepare(`SELECT 1 FROM scenario_source_jobs j JOIN scenario_versions old ON old.id=j.scenario_version_id
   WHERE j.source_id=? AND j.source_event_id=? AND j.attempt_count>0
   AND EXISTS(SELECT 1 FROM json_each(old.steps_snapshot) st WHERE json_extract(st.value,'$.version_step_id')=j.step_id AND json_extract(st.value,'$.live_step_id')=?)`)
            .bind(sourceId, e.id, b.step_id).first())
            continue;
        await db.prepare(`INSERT OR IGNORE INTO scenario_source_jobs(id,line_account_id,friend_id,scenario_version_id,step_id,source_kind,source_id,source_event_id,source_version,scheduled_at,idempotency_key)
   SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rt_store_followup_templates WHERE store_id=? AND sending_status='active' AND template_version=? AND approved_version_id=?)`)
            .bind(crypto.randomUUID(), e.line_account_id, e.friend_id, t.approved_version_id, step.id, e.reservation_id ? 'restaurant_reservation' : 'restaurant_waitlist', sourceId, e.id, e.reservation_version, at.toISOString(), e.reservation_id ? crypto.randomUUID() : e.request_id, e.store_id, t.template_version, t.approved_version_id).run();
    }
}
function instantMs(value: string): number { return Date.parse(reservationInstant(value)); }
