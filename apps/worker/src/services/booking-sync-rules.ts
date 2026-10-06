import { getBookingSyncRules } from '@line-crm/db';
import type { BookingSyncNotice } from '@line-crm/shared';
import type { Env } from '../index.js';
import { dbFor } from './db-router.js';
import { getAccountTimeZone, tzDateStr } from './availability.js';
import { bookingChannelBounds, listBookingConflicts, notifyBookingConflicts } from './booking-channels.js';
import { sendAutomaticBookingLine } from './booking-automatic-line.js';

type DesiredNotice = {key:string;staffId:string;date:string;kind:BookingSyncNotice['kind'];bookingId:string|null;count:number;limit:number|null;message:string};

/** 予約の作成・変更後に再評価。人数ではなくスタッフの予約件数を、店舗の暦日で数える。 */
export async function evaluateBookingSyncNotices(env:Env['Bindings'],accountId:string,now=new Date()) {
  const db=dbFor(env,accountId);
  const rules=await getBookingSyncRules(db,accountId);
  const queued=await db.prepare('SELECT generation FROM booking_sync_notice_queue WHERE line_account_id=?').bind(accountId).first<{generation:number}>();
  const timeZone=await getAccountTimeZone(db,accountId);
  const bounds=bookingChannelBounds(timeZone,now);
  const bookings=await db.prepare(`SELECT b.id,b.staff_id,b.starts_at,b.source,b.status,s.display_name,
      EXISTS(SELECT 1 FROM google_calendar_connections gc WHERE gc.staff_id=s.id AND gc.line_account_id=s.line_account_id AND gc.is_active=1) AS connected
    FROM bookings b JOIN staff s ON s.id=b.staff_id AND s.line_account_id=b.line_account_id
    WHERE b.line_account_id=? AND b.status IN ('requested','confirmed','completed')
    AND julianday(b.starts_at)>=julianday(?) ORDER BY b.starts_at,b.id`)
    .bind(accountId,bounds.todayFrom).all<{id:string;staff_id:string;starts_at:string;source:string;status:string;display_name:string;connected:number}>();
  const groups=new Map<string,{staffId:string;date:string;name:string;count:number;externalId:string|null;connected:boolean}>();
  for(const b of bookings.results) {
    const date=tzDateStr(timeZone,new Date(b.starts_at));const key=`${b.staff_id}:${date}`;
    const group=groups.get(key)??{staffId:b.staff_id,date,name:b.display_name,count:0,externalId:null,connected:!!b.connected};
    group.count++;
    if(b.source!=='liff'&&b.status!=='completed')group.externalId??=b.id;
    groups.set(key,group);
  }
  const desired:DesiredNotice[]=[];
  for(const [key,g] of groups) {
    if(rules.notifyCalendarDisconnected&&!g.connected&&g.externalId)desired.push({key:`calendar:${key}`,staffId:g.staffId,date:g.date,
      kind:'calendar_disconnected',bookingId:g.externalId,count:g.count,limit:null,
      message:`${g.name}さんにLINE以外から予約が入りました。Google カレンダーをつないでください。`});
    if(rules.notifyDailyLimit&&g.count>=rules.dailyLimit-rules.nearLimitRemaining)desired.push({key:`limit:${key}`,staffId:g.staffId,date:g.date,
      kind:'daily_limit',bookingId:null,count:g.count,limit:rules.dailyLimit,
      message:`${g.name}さんの${g.date}の予約は${g.count}件です（上限${rules.dailyLimit}件）。ほかの予約サービスの受付を閉じてください。`});
  }
  if(rules.notifyConflicts)for(const conflict of await listBookingConflicts(db,accountId))desired.push({key:`conflict:${conflict.bookingId}:${conflict.otherBookingId}`,staffId:conflict.staffId,
    date:tzDateStr(timeZone,new Date(conflict.startsAt)),kind:'conflict',bookingId:conflict.bookingId,count:2,limit:null,
    message:`${conflict.staffName}さんの予約が重なっています。予約管理で別のスタッフへの変更を確認してください。`});
  for(const n of desired) {
    await db.prepare(`INSERT INTO booking_sync_notices(id,line_account_id,notice_key,staff_id,target_date,kind,status,booking_id,booking_count,daily_limit,message)
      VALUES(?,?,?,?,?,?,'open',?,?,?,?) ON CONFLICT(line_account_id,notice_key) DO UPDATE SET
      status=CASE WHEN status='resolved' THEN 'open' ELSE status END,
      generation=generation+CASE WHEN status='resolved' THEN 1 ELSE 0 END,
      booking_id=excluded.booking_id,booking_count=excluded.booking_count,daily_limit=excluded.daily_limit,message=excluded.message,updated_at=datetime('now')`)
      .bind(crypto.randomUUID(),accountId,n.key,n.staffId,n.date,n.kind,n.bookingId,n.count,n.limit,n.message).run();
    // 重複予約のLINEは既存の通知処理が担当する。
    if(n.kind!=='conflict') {
      const notice=await db.prepare('SELECT id,generation FROM booking_sync_notices WHERE line_account_id=? AND notice_key=?').bind(accountId,n.key).first<{id:string;generation:number}>();
      if(notice)await db.prepare('INSERT OR IGNORE INTO booking_sync_notice_outbox(id,notice_id,generation,retry_key) VALUES(?,?,?,?)')
        .bind(crypto.randomUUID(),notice.id,notice.generation,crypto.randomUUID()).run();
    }
  }
  await db.prepare(`UPDATE booking_sync_notices SET status='resolved',updated_at=datetime('now')
    WHERE line_account_id=? AND status<>'resolved' AND notice_key NOT IN (SELECT value FROM json_each(?))`)
    .bind(accountId,JSON.stringify(desired.map(n=>n.key))).run();
  if(queued)await db.prepare('DELETE FROM booking_sync_notice_queue WHERE line_account_id=? AND generation=?').bind(accountId,queued.generation).run();
  await dispatchBookingSyncNotices(env,accountId);
}

export async function dispatchBookingSyncNotices(env:Env['Bindings'],accountId?:string) {
  const db=dbFor(env,accountId);
  const rows=await db.prepare(`SELECT o.id,o.retry_key,n.line_account_id,n.message,sm.line_user_id,sm.notification_preferences
    FROM booking_sync_notice_outbox o JOIN booking_sync_notices n ON n.id=o.notice_id
    JOIN staff s ON s.id=n.staff_id AND s.line_account_id=n.line_account_id
    JOIN staff_members sm ON sm.id=s.staff_member_id JOIN line_accounts la ON la.id=n.line_account_id AND la.tenant_id=sm.tenant_id
    WHERE o.sent_at IS NULL AND o.generation=n.generation AND n.status='open' AND sm.is_active=1 AND sm.line_user_id IS NOT NULL
    AND (COALESCE(sm.account_scope,'all')='all' OR sm.assigned_line_account_id=la.id OR EXISTS(SELECT 1 FROM staff_account_scopes sc WHERE sc.staff_id=sm.id AND sc.line_account_id=la.id))
    AND (? IS NULL OR n.line_account_id=?) AND (o.lease_until IS NULL OR datetime(o.lease_until)<=datetime('now')) LIMIT 100`)
    .bind(accountId??null,accountId??null).all<{id:string;retry_key:string;line_account_id:string;message:string;line_user_id:string;notification_preferences:string}>();
  for(const row of rows.results) {
    try {if(JSON.parse(row.notification_preferences)?.operator?.line===false)continue;}catch { /* 旧設定は既定値 */ }
    const lease=crypto.randomUUID();
    const claim=await db.prepare(`UPDATE booking_sync_notice_outbox SET lease_until=datetime('now','+5 minutes'),lease_token=?
      WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`).bind(lease,row.id).run();
    if(!claim.meta.changes)continue;
    try {
      const sent=await sendAutomaticBookingLine(env,{accountId:row.line_account_id,to:row.line_user_id,text:row.message,retryKey:row.retry_key,featureId:'booking'});
      if(sent)await db.prepare("UPDATE booking_sync_notice_outbox SET sent_at=datetime('now') WHERE id=? AND lease_token=?").bind(row.id,lease).run();
    }catch { /* 通知失敗は予約の確定結果を変えない。期限後に同じキーで再試行する。 */ }
  }
}

export async function processBookingSyncNoticeQueue(env:Env['Bindings']) {
  const rows=await dbFor(env).prepare(`SELECT line_account_id FROM booking_sync_notice_queue UNION SELECT line_account_id FROM booking_sync_notices WHERE status='open' LIMIT 100`).all<{line_account_id:string}>();
  for(const row of rows.results) {
    await evaluateBookingSyncNotices(env,row.line_account_id);
    try {await notifyBookingConflicts(dbFor(env,row.line_account_id),row.line_account_id);}catch { /* 既存の通知も同じ再試行キーで回収する */ }
  }
  await dispatchBookingSyncNotices(env);
}
