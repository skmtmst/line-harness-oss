/**
 * N-065 回帰テスト: 取消時の Calendar 削除は台帳駆動で回復する。
 *
 * 安定キー (`<bookingId>:google-calendar:delete`) で台帳行を1行に保つ。
 * ずみなら再実行せず、一時失敗は次の取消再試行で同じ鍵で直す。
 * 外部成功→台帳失敗の間も queued に残るため、相手先の 410 で回収できる。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import {
  processPendingCalendarDeleteOperations,
  removeBookingFromGoogle,
  runBookingGoogleSync,
  runCalendarDeleteOperation,
  syncConfirmedBookingToGoogle,
  verifyStaffCalendarConnection,
} from './booking-calendar-sync.js';
import { BookingExternalCircuits } from './booking-external-circuits.js';
import type { GoogleServiceAccountCredentials } from '../../services/google-service-account.js';

const ACCOUNT = 'cal-account-1';

it('接続確認の読取りも同じ店/接続先の共有遮断を通す', async () => {
  const {db,raw}=createTestD1();
  try {
    const circuit=new BookingExternalCircuits(db),now=Date.now();
    const scope={accountId:ACCOUNT,storeId:ACCOUNT,destination:'google_calendar',connectionId:'connection'};
    for(let n=0;n<5;n++){const admission=await circuit.acquire(scope,now);if(admission.allowed)await circuit.settle(admission.lease,'failure',now);}
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({calendars:{calendar:{busy:[]}}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    const connection={id:'connection',calendar_id:'calendar',auth_type:'oauth',access_token:'fixture-token'};
    await expect(verifyStaffCalendarConnection(connection,{}, {db,accountId:ACCOUNT})).rejects.toThrow('calendar_read_failed');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(verifyStaffCalendarConnection(connection,{}, {db,accountId:'other'})).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {raw.close();}
});

function seed(raw: import('better-sqlite3').Database, bookingId: string, externalEventId: string | null): void {
  raw.prepare(
    `INSERT OR IGNORE INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(ACCOUNT, `channel-${ACCOUNT}`, ACCOUNT);
  raw.prepare(
    `INSERT INTO bookings
       (id, line_account_id, friend_id, staff_id, menu_id,
        starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at,
        external_event_id)
     VALUES (?, ?, 'cal-friend-1', 'cal-staff-1', 'cal-menu-1',
        '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
        'cancelled', 1000, '2026-09-01T00:00:00.000Z', ?)`,
  ).run(bookingId, ACCOUNT, externalEventId);
}

function opStatus(raw: import('better-sqlite3').Database, bookingId: string) {
  return raw.prepare(
    `SELECT status FROM booking_operation_runs
      WHERE line_account_id = ? AND idempotency_key = ?`,
  ).get(ACCOUNT, `${bookingId}:google-calendar:delete`) as { status: string } | undefined;
}

describe('取消時の Calendar 削除の台帳', () => {
  it('成功は1回だけ外部へ出し、再試行では触らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-1', 'google-event-1');
    let calls = 0;
    const remove = async () => { calls++; };

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-1', lineAccountId: ACCOUNT, remove,
    })).toBe('succeeded');
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-1', lineAccountId: ACCOUNT, remove,
    })).toBe('succeeded');
    expect(calls).toBe(1);
    expect(opStatus(raw, 'cal-bk-1')).toEqual({ status: 'succeeded' });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM booking_operation_runs`).get(),
    ).toEqual({ c: 1 });
  });

  it('一時失敗は台帳に残し、次の再試行で同じ鍵で直す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-2', 'google-event-2');
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('transient network error');
    };

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-2', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('retry_wait');
    expect(opStatus(raw, 'cal-bk-2')).toEqual({ status: 'retry_wait' });
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-2', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('succeeded');
    expect(calls).toBe(2);
    expect(opStatus(raw, 'cal-bk-2')).toEqual({ status: 'succeeded' });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM booking_operation_runs`).get(),
    ).toEqual({ c: 1 });
  });

  it('cron が retry_wait を拾い、安定キーのまま直す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-4', 'google-event-4');
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('transient network error');
    };

    // 初回は外部失敗で残る (200 後の残留)。
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-4', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('retry_wait');

    // cron が自動で再試行し、同じ鍵のまま成功へ閉じる (二重削除なし)。
    const drained = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:00:00.000Z'),
      remove: async () => { await flaky(); },
    });
    expect(drained).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });
    expect(calls).toBe(2);
    expect(opStatus(raw, 'cal-bk-4')).toEqual({ status: 'succeeded' });
    // もう拾わない。
    const again = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:01:00.000Z'),
      remove: async () => { calls++; },
    });
    expect(again.processed).toBe(0);
    expect(calls).toBe(2);
  });

  it('lease中の行は取らず、古い lease は回収する', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-5', 'google-event-5');
    seed(raw, 'cal-bk-6', 'google-event-6');
    const failOnce = (() => {
      let n = 0;
      return async () => { n++; if (n === 1) throw new Error('transient'); };
    })();
    // 両方とも retry_wait で残す (bk-5 の remove は1回失敗させる)。
    await runCalendarDeleteOperation(db, { bookingId: 'cal-bk-5', lineAccountId: ACCOUNT, remove: failOnce });
    await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-6', lineAccountId: ACCOUNT,
      remove: async () => { throw new Error('transient'); },
    });
    expect(opStatus(raw, 'cal-bk-5')).toEqual({ status: 'retry_wait' });
    expect(opStatus(raw, 'cal-bk-6')).toEqual({ status: 'retry_wait' });

    // cal-bk-5 は別 worker が掴んだばかり (lease 有効)、bk-6 は止まったまま。
    raw.prepare(`UPDATE booking_operation_runs SET opened_at = ?, updated_at = ? WHERE booking_id = ?`)
      .run('2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 'cal-bk-5');
    raw.prepare(`UPDATE booking_operation_runs SET opened_at = ?, updated_at = ? WHERE booking_id = ?`)
      .run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'cal-bk-6');

    let calls = 0;
    const drained = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:00:00.000Z'),
      remove: async () => { calls++; },
    });
    // 古い方だけ拾い、外部はもう消しずみ扱いで成功へ閉じる (410 相当)。
    expect(drained.processed).toBe(1);
    expect(calls).toBe(1);
    expect(opStatus(raw, 'cal-bk-5')).toEqual({ status: 'retry_wait' });
    expect(opStatus(raw, 'cal-bk-6')).toEqual({ status: 'succeeded' });
  });

  it('消す物が無ければ外部へ出ず skipped で閉じる', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-3', null);
    let calls = 0;

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-3', lineAccountId: ACCOUNT, remove: async () => { calls++; },
    })).toBe('skipped');
    expect(calls).toBe(0);
    expect(opStatus(raw, 'cal-bk-3')).toEqual({ status: 'skipped' });
  });
});

/*
 * R327・R328 回帰テスト: Google 同期の二重作成と、連携解除後の取りこぼし。
 *
 * Google への通信は fetch を差し替えて呼出し回数だけを見る
 * (本物の Google には出ない)。
 */

const CREDS = {} as GoogleServiceAccountCredentials;

function seedConfirmedWithConnection(
  raw: import('better-sqlite3').Database,
  bookingId: string,
  options?: { externalEventId?: string | null; externalCalendarId?: string; connectionActive?: number },
): void {
  raw.prepare(
    `INSERT OR IGNORE INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(ACCOUNT, `channel-${ACCOUNT}`, ACCOUNT);
  raw.prepare(
    `INSERT OR IGNORE INTO staff (id, line_account_id, name, display_name)
     VALUES ('cal-staff-1', ?, 'Staff One', 'Staff One')`,
  ).run(ACCOUNT);
  raw.prepare(
    `INSERT OR IGNORE INTO menus (id, line_account_id, name, duration_minutes, base_price)
     VALUES ('cal-menu-1', ?, 'Menu One', 60, 1000)`,
  ).run(ACCOUNT);
  raw.prepare(
    `INSERT INTO bookings
       (id, line_account_id, friend_id, staff_id, menu_id,
        starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at,
        external_event_id, external_calendar_id)
     VALUES (?, ?, 'cal-friend-1', 'cal-staff-1', 'cal-menu-1',
        '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
        'confirmed', 1000, '2026-09-01T00:00:00.000Z', ?, ?)`,
  ).run(
    bookingId,
    ACCOUNT,
    options?.externalEventId ?? null,
    options?.externalEventId ? (options.externalCalendarId ?? 'cal-1') : null,
  );
  raw.prepare(
    `INSERT OR IGNORE INTO google_calendar_connections
       (id, calendar_id, line_account_id, staff_id, access_token, auth_type, is_active)
     VALUES ('conn-1', 'cal-1', ?, 'cal-staff-1', 'token-1', 'oauth', ?)`,
  ).run(ACCOUNT, options?.connectionActive ?? 1);
  // B7: 同期を試す既存ケースは、店・担当の書き込みを明示的にオンにする。
  raw.prepare(`INSERT OR IGNORE INTO booking_calendar_switches(line_account_id,scope_id,write_enabled,updated_by,updated_at) VALUES(?,'',1,'test',datetime('now'))`).run(ACCOUNT);
  raw.prepare(`INSERT OR IGNORE INTO booking_calendar_switches(line_account_id,scope_id,write_enabled,updated_by,updated_at) VALUES(?,'cal-staff-1',1,'test',datetime('now'))`).run(ACCOUNT);

}

/** Google への fetch を差し替え、呼出し回数と要求本文を記録する。 */
function stubGoogleFetch() {
  const created: { id: string | undefined }[] = [];
  const deleted: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE') {
      deleted.push(url);
      return new Response(null, { status: 204 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: string } : {};
    created.push({ id: body.id });
    return new Response(JSON.stringify({ id: body.id ?? `evt-${created.length}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { created, deleted, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('R327: 同時再試行で Google 予定を二重に作らない', () => {
  it('REV-H1: 旧版の予定ID確保後の中断は未実行と断定せず、GETだけで確認する',async()=>{
    const {db,raw}=createTestD1();seedConfirmedWithConnection(raw,'cal-interrupted',{externalEventId:'lh0123456789abcdef'});
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(init?.method??'GET').toBe('GET');return new Response('{}',{status:404});});
    vi.stubGlobal('fetch',transport);
    await expect(syncConfirmedBookingToGoogle(db,CREDS,'cal-interrupted','lh0123456789abcdef')).rejects.toThrow('delivery_unknown');
    expect(transport).toHaveBeenCalledTimes(1);raw.close();
  });
  it('REV-H1: Google受理後の応答消失はGETだけで照合し、POSTは一度だけ', async () => {
    const {db,raw}=createTestD1();seedConfirmedWithConnection(raw,'cal-recovery');
    let accepted:Record<string,unknown>|null=null,posts=0,reads=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==='POST'){posts++;accepted=JSON.parse(String(init.body));throw new Error('accepted response lost');}
      reads++;return new Response(JSON.stringify(accepted),{status:200});
    }));
    await expect(syncConfirmedBookingToGoogle(db,CREDS,'cal-recovery','lh0123456789abcdef')).rejects.toThrow('delivery_unknown');
    await expect(syncConfirmedBookingToGoogle(db,CREDS,'cal-recovery','lh0123456789abcdef')).resolves.toMatchObject({synced:true,eventId:'lh0123456789abcdef'});
    expect(posts).toBe(1);expect(reads).toBe(1);raw.close();
  });
  it('同時に2本走っても外部作成は1件、予約と2つの結果の ID が一致する', async () => {
    const { db, raw } = createTestD1();
    seedConfirmedWithConnection(raw, 'cal-sync-1');
    const { created } = stubGoogleFetch();

    const outcomes = await Promise.allSettled([
      syncConfirmedBookingToGoogle(db, CREDS, 'cal-sync-1'),
      syncConfirmedBookingToGoogle(db, CREDS, 'cal-sync-1'),
    ]);
    expect(created).toHaveLength(1);
    const successes=outcomes.filter((o):o is PromiseFulfilledResult<{synced:boolean;eventId?:string}>=>o.status==='fulfilled');
    expect(successes.some(result=>result.value.synced)).toBe(true);
    // 敗者を受理済みと偽らず、次の読込みで成功済みのcheckpointを返す。
    const final=await syncConfirmedBookingToGoogle(db,CREDS,'cal-sync-1');
    expect(final.synced).toBe(true);expect(created).toHaveLength(1);
    const booking=raw.prepare("SELECT external_event_id,external_calendar_id FROM bookings WHERE id='cal-sync-1'")
      .get() as {external_event_id:string;external_calendar_id:string};
    expect(final.eventId).toBe(booking.external_event_id);expect(booking.external_calendar_id).toBe('cal-1');
  });
});

describe('R328: 連携が無いのに消せた扱いにしない', () => {
  function setConnectionActive(raw: import('better-sqlite3').Database, active: number): void {
    raw.prepare(`UPDATE google_calendar_connections SET is_active = ? WHERE id = 'conn-1'`).run(active);
  }

  it('取消の削除は接続無しで成功にせず、再接続後の再試行で消せる', async () => {
    const { db, raw } = createTestD1();
    seedConfirmedWithConnection(raw, 'cal-sync-2', {
      externalEventId: 'evt-old-1',
      connectionActive: 0,
    });
    raw.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = 'cal-sync-2'`).run();
    const { deleted } = stubGoogleFetch();

    const first = await runCalendarDeleteOperation(db, {
      bookingId: 'cal-sync-2',
      lineAccountId: ACCOUNT,
      remove: () => removeBookingFromGoogle(db, CREDS, 'cal-sync-2'),
    });
    expect(first).toBe('retry_wait');
    expect(deleted).toHaveLength(0);
    expect(opStatus(raw, 'cal-sync-2')).toEqual({ status: 'retry_wait' });

    // 再接続後の再送で旧予定を1回だけ消す。
    setConnectionActive(raw, 1);
    const second = await runCalendarDeleteOperation(db, {
      bookingId: 'cal-sync-2',
      lineAccountId: ACCOUNT,
      remove: () => removeBookingFromGoogle(db, CREDS, 'cal-sync-2'),
    });
    expect(second).toBe('succeeded');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('evt-old-1');
    expect(opStatus(raw, 'cal-sync-2')).toEqual({ status: 'succeeded' });
  });

  it('取消済み予約の再同期も接続無しなら retry_wait で旧IDを失わない', async () => {
    const { db, raw } = createTestD1();
    seedConfirmedWithConnection(raw, 'cal-sync-3', {
      externalEventId: 'evt-old-2',
      connectionActive: 0,
    });
    raw.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = 'cal-sync-3'`).run();
    const { deleted } = stubGoogleFetch();

    const first = await runBookingGoogleSync(db, {
      bookingId: 'cal-sync-3', lineAccountId: ACCOUNT, credentials: CREDS,
    });
    expect(first).toBe('retry_wait');
    expect(deleted).toHaveLength(0);
    const kept = raw
      .prepare(`SELECT external_event_id FROM bookings WHERE id = 'cal-sync-3'`)
      .get() as { external_event_id: string };
    expect(kept.external_event_id).toBe('evt-old-2');

    setConnectionActive(raw, 1);
    const second = await runBookingGoogleSync(db, {
      bookingId: 'cal-sync-3', lineAccountId: ACCOUNT, credentials: CREDS,
    });
    expect(second).toBe('succeeded');
    expect(deleted).toHaveLength(1);
    const cleared = raw
      .prepare(`SELECT external_event_id FROM bookings WHERE id = 'cal-sync-3'`)
      .get() as { external_event_id: string | null };
    expect(cleared.external_event_id).toBeNull();
  });

  it('確定予約の再同期も旧接続が無ければ新規作成まで進まない', async () => {
    const { db, raw } = createTestD1();
    seedConfirmedWithConnection(raw, 'cal-sync-4', {
      externalEventId: 'evt-old-3',
      connectionActive: 0,
    });
    const { created, deleted } = stubGoogleFetch();

    const outcome = await runBookingGoogleSync(db, {
      bookingId: 'cal-sync-4', lineAccountId: ACCOUNT, credentials: CREDS,
    });
    expect(outcome).toBe('retry_wait');
    expect(deleted).toHaveLength(0);
    expect(created).toHaveLength(0);
    const kept = raw
      .prepare(`SELECT external_event_id FROM bookings WHERE id = 'cal-sync-4'`)
      .get() as { external_event_id: string };
    expect(kept.external_event_id).toBe('evt-old-3');
  });
});
