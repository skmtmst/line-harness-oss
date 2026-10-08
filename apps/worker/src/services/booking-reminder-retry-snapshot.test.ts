import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processDueReminders } from './booking-reminders.js';
import { sendBookingNotification } from './booking-notifier.js';

const NOW = new Date('2026-10-04T03:00:00.000Z');
const LATER = new Date('2026-10-04T05:00:00.000Z');
const migration = readFileSync(new URL('../../../../packages/db/migrations/610_booking_reminder_request_snapshot.sql', import.meta.url), 'utf8');

test('610: migration前の行の状態・本文の元データを変えず、保存欄はNULLで追加する', () => {
  const raw = new Database(':memory:');
  try {
    const original = readFileSync(new URL('../../../../packages/db/migrations/036_booking.sql', import.meta.url), 'utf8');
    raw.exec(`CREATE TABLE bookings (id TEXT PRIMARY KEY); INSERT INTO bookings VALUES ('B1');`);
    raw.exec(original.match(/CREATE TABLE IF NOT EXISTS booking_reminders \([\s\S]*?\n\);/)![0]);
    raw.exec(`INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at, status, retry_count, last_error)
      VALUES ('legacy', 'B1', 'hours_before', '2026-10-04', 'failed', 1, 'timeout');`);
    const before = raw.prepare('SELECT * FROM booking_reminders').get();
    raw.exec(migration);
    expect(raw.prepare('SELECT * FROM booking_reminders').get()).toEqual({
      ...before as object, retry_key: null, recipient_line_user_id: null, messages_json: null,
    });
  } finally {
    raw.close();
  }
});

describe('W4: 予約通知の要求を再試行間で固定する（実SQL・実送信処理）', () => {
  let fixture: SqliteD1;
  let requests: Array<{ key: string | null; body: string }>;
  let responseStatus: number;

  beforeEach(() => {
    fixture = createTestD1({ foreignKeys: true });
    fixture.raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('acc1', 'channel1', '試験店舗', 'test-token', 'test-secret', '00000000-0000-4000-8000-000000000001');
      INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U1', 'acc1');
      INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('s1', 'acc1', 'S', '担当');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
      VALUES ('m1', 'acc1', '相談', 60, 100);
      INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at,
        ends_at, block_ends_at, status, price_at_booking, requested_at, notification_policy_snapshot)
      VALUES ('B1', 'acc1', 'f1', 's1', 'm1', '2026-10-05T02:00:00.000Z',
        '2026-10-05T03:00:00.000Z', '2026-10-05T03:00:00.000Z', 'confirmed', 100,
        '2026-01-01', '{}');
      INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at)
      VALUES ('R1', 'B1', 'hours_before', '2026-10-04T02:00:00.000Z');
    `);
    requests = [];
    responseStatus = 500;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.has('X-Line-Harness-Source')).toBe(false);
      requests.push({ key: headers.get('X-Line-Retry-Key'), body: init.body as string });
      return new Response('', { status: responseStatus });
    }));
  });

  afterEach(() => {
    fixture.raw.close();
    vi.unstubAllGlobals();
  });

  const run = (fixture: SqliteD1, now = NOW) => processDueReminders(fixture.db, {
    now, sender: sendBookingNotification,
  });

  function snapshot() {
    return fixture.raw.prepare(`SELECT retry_key, recipient_line_user_id, messages_json
      FROM booking_reminders WHERE id = 'R1'`).get() as {
      retry_key: string | null; recipient_line_user_id: string | null; messages_json: string | null;
    };
  }

  function state() {
    return fixture.raw.prepare(`SELECT status, retry_count, sent_at FROM booking_reminders WHERE id = 'R1'`).get();
  }

  test.each(['day_before', 'hours_before'])('%s: 失敗後に時刻・名前・宛先が変わっても同じUUID・同じ要求本文を送り、成功済みは送らない', async (kind) => {
    fixture.raw.prepare(`UPDATE booking_reminders SET kind = ? WHERE id = 'R1'`).run(kind);
    expect(await run(fixture)).toEqual({ sent: 0, failed: 1 });
    const saved = snapshot();
    expect(saved).toEqual({ retry_key: requests[0].key, recipient_line_user_id: 'U1',
      messages_json: JSON.stringify(JSON.parse(requests[0].body).messages) });
    expect(state()).toEqual({ status: 'failed', retry_count: 1, sent_at: null });
    fixture.raw.exec(`
      UPDATE friends SET line_user_id = 'Uchanged' WHERE id = 'f1';
      UPDATE menus SET name = '変更後' WHERE id = 'm1';
      UPDATE staff SET display_name = '変更後の担当' WHERE id = 's1';
    `);
    responseStatus = 200;
    expect(await run(fixture, LATER)).toEqual({ sent: 1, failed: 0 });
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(snapshot()).toEqual(saved);
    expect(state()).toEqual({ status: 'sent', retry_count: 2, sent_at: LATER.toISOString() });
    const body = JSON.parse(requests[0].body);
    expect(body.to).toBe('U1');
    expect(body.messages[0].text).toContain(kind === 'hours_before' ? 'あと 23 時間' : '明日のご予約');
    expect(body.messages[0].text).toContain('メニュー: 相談');
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    expect(requests).toHaveLength(2);
  });

  test('旧failed行のNULLは今回の時刻で組み立てて保存し、以後固定する', async () => {
    fixture.raw.exec(`UPDATE booking_reminders SET status = 'failed', retry_count = 1 WHERE id = 'R1'`);
    expect(snapshot()).toEqual({ retry_key: null, recipient_line_user_id: null, messages_json: null });
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 1 });
    expect(JSON.parse(requests[0].body).messages[0].text).toContain('あと 21 時間');
    responseStatus = 200;
    expect(await run(fixture, new Date('2026-10-04T06:00:00.000Z'))).toEqual({ sent: 1, failed: 0 });
    expect(requests[1]).toEqual(requests[0]);
    expect(snapshot().retry_key).toBe(requests[0].key);
  });

  test('DBに要求を保存できなければ送信しない', async () => {
    fixture.raw.exec(`CREATE TRIGGER reject_snapshot BEFORE UPDATE OF messages_json ON booking_reminders
      BEGIN SELECT RAISE(ABORT, 'snapshot-save-failed'); END;`);
    expect(await run(fixture)).toEqual({ sent: 0, failed: 1 });
    expect(requests).toHaveLength(0);
    expect(snapshot()).toEqual({ retry_key: null, recipient_line_user_id: null, messages_json: null });
    expect(state()).toEqual({ status: 'failed', retry_count: 1, sent_at: null });
  });

  test('LINE受理後に成功記録が失敗しても同じ要求を再送し、409で成功にできる', async () => {
    fixture.raw.exec(`CREATE TRIGGER reject_sent BEFORE UPDATE OF status ON booking_reminders
      WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'completion-save-failed'); END;`);
    responseStatus = 200;
    expect(await run(fixture)).toEqual({ sent: 0, failed: 1 });
    const saved = snapshot();
    fixture.raw.exec('DROP TRIGGER reject_sent');
    responseStatus = 409;
    expect(await run(fixture, LATER)).toEqual({ sent: 1, failed: 0 });
    expect(requests[1]).toEqual(requests[0]);
    expect(snapshot()).toEqual(saved);
  });

  test('Worker停止後の貸出回収でも保存した宛先・本文・キーを使う', async () => {
    const savedMessages = [{ type: 'text', text: '初回に送った内容' }];
    const key = crypto.randomUUID();
    fixture.raw.prepare(`UPDATE booking_reminders SET retry_count = 1, sent_at = ?,
      retry_key = ?, recipient_line_user_id = 'Uoriginal', messages_json = ? WHERE id = 'R1'`)
      .run(NOW.toISOString(), key, JSON.stringify(savedMessages));
    // 期限内は貸出中のため再送しない。
    expect(await run(fixture, new Date(NOW.getTime() + 60_000))).toEqual({ sent: 0, failed: 0 });
    responseStatus = 200;
    expect(await run(fixture, LATER)).toEqual({ sent: 1, failed: 0 });
    expect(requests).toEqual([{ key, body: JSON.stringify({ to: 'Uoriginal', messages: savedMessages }) }]);
  });

  test('送信前に保存が完了し、応答待ち中の期限切れ回収でも同じ要求を使う', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = { key: new Headers(init.headers).get('X-Line-Retry-Key'), body: init.body as string };
      requests.push(request);
      const saved = snapshot();
      expect(saved.retry_key).toBe(request.key);
      expect(saved.recipient_line_user_id).toBe(JSON.parse(request.body).to);
      expect(saved.messages_json).toBe(JSON.stringify(JSON.parse(request.body).messages));
      if (requests.length === 1) await gate;
      return new Response('', { status: 200 });
    }));
    const first = run(fixture);
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      fixture.raw.exec(`UPDATE friends SET line_user_id = 'Uchanged' WHERE id = 'f1'`);
      expect(await run(fixture, LATER)).toEqual({ sent: 1, failed: 0 });
      expect(requests[1]).toEqual(requests[0]);
    } finally {
      release();
      await first;
    }
    expect(state()).toEqual({ status: 'sent', retry_count: 2, sent_at: LATER.toISOString() });
  });

  test.each([200, 500])('期限切れの先行送信がHTTP %iで遅れて戻っても、新しい試行の状態を上書きしない', async (firstStatus) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({ key: new Headers(init.headers).get('X-Line-Retry-Key'), body: init.body as string });
      if (requests.length === 1) {
        await gate;
        return new Response('', { status: firstStatus });
      }
      return new Response('', { status: 500 });
    }));
    const first = run(fixture);
    let firstResult;
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 1 });
      expect(requests[1]).toEqual(requests[0]);
    } finally {
      release();
      firstResult = await first;
    }
    expect(firstResult).toEqual({ sent: 0, failed: 0 });
    expect(state()).toEqual({ status: 'failed', retry_count: 2, sent_at: null });
  });

  test('保存ずみでも成功済み・停止済み・取消済み・上限失敗の通知は送らない', async () => {
    await run(fixture);
    const saved = snapshot();
    requests = [];
    for (const status of ['sent', 'cancelled', 'failed_permanent']) {
      fixture.raw.prepare(`UPDATE booking_reminders SET status = ? WHERE id = 'R1'`).run(status);
      expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    }
    fixture.raw.exec(`UPDATE booking_reminders SET status = 'failed' WHERE id = 'R1';
      UPDATE tenants SET status = 'suspended';`);
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    expect(state()).toEqual({ status: 'cancelled', retry_count: 1, sent_at: null });
    expect(requests).toHaveLength(0);
    expect(snapshot()).toEqual(saved);
  });

  test('保存ずみでも予約の取消・通知OFF・緊急停止なら再送しない', async () => {
    await run(fixture);
    const saved = snapshot();
    requests = [];
    fixture.raw.exec(`UPDATE bookings SET status = 'cancelled' WHERE id = 'B1'`);
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    fixture.raw.exec(`UPDATE bookings SET status = 'confirmed', notification_policy_snapshot = '{"hours_before":false}' WHERE id = 'B1'`);
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    fixture.raw.exec(`UPDATE bookings SET notification_policy_snapshot = '{}' WHERE id = 'B1';
      INSERT INTO operation_control_sets (scope_key, line_account_id, states_json, updated_at)
      VALUES ('acc1', 'acc1', '{"reminder_dispatch":"stopped"}', '2026-10-04');`);
    expect(await run(fixture, LATER)).toEqual({ sent: 0, failed: 0 });
    expect(state()).toEqual({ status: 'failed', retry_count: 1, sent_at: null });
    expect(requests).toHaveLength(0);
    expect(snapshot()).toEqual(saved);
  });

  test('保存直後の緊急停止は送信権だけを戻し、再開しても保存した要求を変えない', async () => {
    const db = fixture.db;
    let stopOnce = true;
    fixture.db = {
      ...db,
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        if (!sql.includes('RETURNING retry_key')) return stmt;
        return {
          ...stmt,
          bind(...args: unknown[]) {
            const bound = stmt.bind(...args);
            return {
              ...bound,
              async first<T>() {
                const result = await bound.first<T>();
                if (result && stopOnce) {
                  stopOnce = false;
                  fixture.raw.exec(`INSERT INTO operation_control_sets (scope_key, line_account_id, states_json, updated_at)
                    VALUES ('acc1', 'acc1', '{"reminder_dispatch":"stopped"}', '2026-10-04');`);
                }
                return result;
              },
            };
          },
        };
      },
    } as D1Database;
    expect(await run(fixture)).toEqual({ sent: 0, failed: 0 });
    expect(requests).toHaveLength(0);
    expect(state()).toEqual({ status: 'pending', retry_count: 0, sent_at: null });
    const saved = snapshot();
    expect(JSON.parse(saved.messages_json!)[0].text).toContain('あと 23 時間');
    fixture.raw.exec(`DELETE FROM operation_control_sets;
      UPDATE friends SET line_user_id = 'Uchanged' WHERE id = 'f1';`);
    responseStatus = 200;
    expect(await run(fixture, LATER)).toEqual({ sent: 1, failed: 0 });
    expect(snapshot()).toEqual(saved);
    expect(requests).toEqual([{ key: saved.retry_key,
      body: JSON.stringify({ to: 'U1', messages: JSON.parse(saved.messages_json!) }) }]);
  });
});
