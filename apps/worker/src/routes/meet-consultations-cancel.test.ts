import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../index.js';

// 権限の検証は meet-consultations.security.test.ts が持つ。ここで見たいのは
// 本番ルートの取消・再送の挙動なので、認証は通った状態にしてから渡す。
function makeApp(db: unknown) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    return next();
  });
  return app;
}

const { meetConsultations } = await import('./meet-consultations.js');

function sqliteAsD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[], success: true, meta: {} }),
      run: async <T>() => {
        const info = sqlite.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: info.changes } } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  };
  return {
    prepare,
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results as T;
    },
  } as unknown as D1Database;
}

const S1 = '2026-09-20T01:00:00.000Z';
const S1_DAY_BEFORE = '2026-09-19T01:00:00.000Z';
const S1_HOUR_BEFORE = '2026-09-20T00:00:00.000Z';
const S2 = '2026-09-22T01:00:00.000Z';
const S2_HOUR_BEFORE = '2026-09-22T00:00:00.000Z';

function seedBase(sqlite: Database.Database) {
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc1','channel-1','A店','token','secret'),
           ('acc2','channel-2','B店','token2','secret2');
    INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('owner-1','acc1','Owner','Owner');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000'),
           ('f2','U2','太郎','acc2',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
    INSERT INTO reminders
      (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
    VALUES ('rb-rule','rule','acc1',1,'booking','countdown','published'),
           ('rb-rule-2','rule2','acc2',1,'booking','countdown','published');
    INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
    VALUES ('rb-step','rb-rule',-60,'text','ご来店をお待ちしています'),
           ('rb-step-2','rb-rule-2',-60,'text','ご来店をお待ちしています');
    INSERT INTO meet_consultations
      (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
    VALUES ('MC1','EV1','f1','個別相談','${S1}','2026-09-20T02:00:00.000Z',
      'https://meet.google.com/abc-defg-hij','confirmed');
    INSERT INTO meet_consultation_reminders
      (id, consultation_id, kind, scheduled_at, status, sent_at, retry_count, created_at, updated_at)
    VALUES ('MR-day','MC1','day_before','${S1_DAY_BEFORE}','sent',
        '2026-09-19T01:00:05.000Z',0,'2026-09-01T00:00:00.000Z','2026-09-19T01:00:05.000Z'),
           ('MR-hour','MC1','hour_before','${S1_HOUR_BEFORE}','pending',
        NULL,0,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z');
    INSERT INTO friend_reminders
      (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
    VALUES ('FR-meet','f1','rb-rule','${S1}','active','meet','MC1','EV1');
  `);
}

function buildApp(sqlite: Database.Database) {
  const app = makeApp(sqliteAsD1(sqlite));
  app.route('/', meetConsultations);
  return { app, env: { DB: sqliteAsD1(sqlite) } };
}

const postBody = {
  externalEventId: 'EV1',
  friendId: 'f1',
  title: '個別相談',
  startsAt: S2,
  endsAt: '2026-09-22T02:00:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
};

describe('Meet V6連動 (実ルート)', () => {
  test('日程変更で送信ずみ前日通知は履歴のまま、未来分だけ再設定する', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBase(sqlite);
      const { app, env } = buildApp(sqlite);
      const res = await app.request('/api/meet-consultations', {
        method: 'POST',
        body: JSON.stringify(postBody),
        headers: { 'Content-Type': 'application/json' },
      }, env);
      expect(res.status).toBe(201);
      // 送信ずみは pending に戻さず、sent_at も消さない (履歴保持)。
      expect(sqlite.prepare(
        `SELECT status, sent_at, scheduled_at FROM meet_consultation_reminders WHERE id = 'MR-day'`,
      ).get()).toEqual({
        status: 'sent',
        sent_at: '2026-09-19T01:00:05.000Z',
        scheduled_at: S1_DAY_BEFORE,
      });
      // 未来分だけ新しい日時に直る。
      expect(sqlite.prepare(
        `SELECT status, scheduled_at FROM meet_consultation_reminders WHERE id = 'MR-hour'`,
      ).get()).toEqual({ status: 'pending', scheduled_at: S2_HOUR_BEFORE });
      // V6 も新しい起点へ直る。
      expect(sqlite.prepare(
        `SELECT target_date, status FROM friend_reminders WHERE id = 'FR-meet'`,
      ).get()).toEqual({ target_date: S2, status: 'active' });
    } finally {
      sqlite.close();
    }
  });

  test('店舗跨ぎの残りもDELETEで止め、別の相談には触らない', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBase(sqlite);
      sqlite.exec(`
        -- 友だち変更の失敗後: 相談だけ新店舗へ進み、旧店舗の通知が残った状態。
        UPDATE meet_consultations SET friend_id = 'f2' WHERE id = 'MC1';
        -- 別の相談の通知 (触れてはいけない)。
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-other','f1','rb-rule','${S1}','active','meet','MC-other','EV-other');
      `);
      const { app, env } = buildApp(sqlite);
      const res = await app.request('/api/meet-consultations/EV1', { method: 'DELETE' }, env);
      expect(res.status).toBe(200);
      // 旧店舗に残った通知も止まる (店舗をまたいだ残留の修正)。
      expect(sqlite.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-meet'`,
      ).get()).toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-other'`,
      ).get()).toEqual({ status: 'active' });
      expect(sqlite.prepare(
        `SELECT status FROM meet_consultations WHERE id = 'MC1'`,
      ).get()).toEqual({ status: 'cancelled' });
    } finally {
      sqlite.close();
    }
  });

  test('送信権の貸出中は409で再試行させ、送信後に取消せる', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBase(sqlite);
      sqlite.exec(`
        INSERT INTO reminder_delivery_runs (
          id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, lease_expires_at, created_at, updated_at
        ) VALUES (
          'RUN-meet','acc1','rb-rule','FR-meet','f1',
          'rb-step','${S1_HOUR_BEFORE}','idem-meet','retry-meet',
          'claimed','2099-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'
        );
      `);
      const { app, env } = buildApp(sqlite);
      // 貸出中は確定させず 409。
      const conflicted = await app.request('/api/meet-consultations/EV1', { method: 'DELETE' }, env);
      expect(conflicted.status).toBe(409);
      expect(sqlite.prepare(
        `SELECT status FROM meet_consultations WHERE id = 'MC1'`,
      ).get()).toEqual({ status: 'confirmed' });
      expect(sqlite.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-meet'`,
      ).get()).toEqual({ status: 'active' });
      // 送信が終われば再試行で止まる。
      sqlite.prepare(
        `UPDATE reminder_delivery_runs SET status = 'succeeded', lease_expires_at = NULL WHERE id = 'RUN-meet'`,
      ).run();
      const retried = await app.request('/api/meet-consultations/EV1', { method: 'DELETE' }, env);
      expect(retried.status).toBe(200);
      expect(sqlite.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-meet'`,
      ).get()).toEqual({ status: 'cancelled' });
    } finally {
      sqlite.close();
    }
  });
});
