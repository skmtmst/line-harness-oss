import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * 一覧の並びが、アカウントを選んでいるときも display_order を見ることを確かめる。
 *
 * **この試験は、161 を入れた直後には通らない。**
 * `GET /api/reminders` はアカウントを指定したときだけ別のSQLを通る。そこが
 * `ORDER BY created_at DESC` のままでも、指定しない経路は直っているので、
 * 件数や中身を見る試験は全部通ってしまう。
 *
 * アカウントの選択は既定で先頭のアカウントに入るため、**指定するほうが
 * 通常の状態**。効かないほうが既定になっていた。
 *
 * 並びは「返ってきた順」でしか確かめられないので、SQLの文字列ではなく
 * **実際に流れたSQL**を見る。文字列を見ると、書き換えたつもりで別の場所を
 * 直したときに気づけない。
 */

const mocks = {
  getReminders: vi.fn(async () => []),
  getReminderById: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  getReminderSteps: vi.fn(async () => []),
  createReminderStep: vi.fn(),
  deleteReminderStep: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  getFriendReminders: vi.fn(async () => []),
  cancelFriendReminder: vi.fn(),
  reorderReminders: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { reminders } = await import('./reminders.js');

/** 流れたSQLを覚えておく、最低限の D1 の代わり。 */
function makeDb(seen: string[]) {
  return {
    prepare(sql: string) {
      seen.push(sql);
      return {
        bind: () => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({}),
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({}),
      };
    },
  };
}

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', reminders);
  return app;
}

describe('リマインダ一覧の並び', () => {
  it('アカウントを選んでいるときも display_order を見る', async () => {
    const seen: string[] = [];
    const app = makeApp();
    const res = await app.request('/api/reminders?lineAccountId=acc-1', {}, {
      DB: makeDb(seen),
    });
    expect(res.status).toBe(200);

    const listSql = seen.find((sql) => sql.includes('FROM reminders'));
    expect(listSql, 'reminders を読むSQLが流れていません').toBeTruthy();
    expect(
      listSql,
      'アカウントを選ぶと display_order を見ない並びになっています。' +
        '画面から並べ替えても効きません（161）。',
    ).toContain('display_order');
  });

  it('アカウントを選んでいるとき、どのアカウントでも使うもの（NULL）も拾う', async () => {
    /*
     * 作成画面は lineAccountId を送っていないので、画面から作った
     * リマインダは必ず line_account_id = NULL になる。ここで NULL を
     * 落とすと、**作った直後から一覧に出てこない。** エラーは出ない。
     *
     * このリポジトリでは NULL は「どのアカウントでも使う」の意味で、
     * シナリオ・自動応答・オートメーション・成果地点が同じ書き方をしている。
     */
    const seen: string[] = [];
    const app = makeApp();
    const res = await app.request('/api/reminders?lineAccountId=acc-1', {}, {
      DB: makeDb(seen),
    });
    expect(res.status).toBe(200);

    const listSql = seen.find((sql) => sql.includes('FROM reminders'));
    expect(
      listSql?.replace(/\s+/g, ' '),
      'line_account_id が NULL のリマインダが一覧から落ちます。' +
        '画面から作ったものは必ず NULL なので、作った直後から出てきません。',
    ).toContain('line_account_id IS NULL');
  });

  it('アカウントを選んでいないときは getReminders() に任せる', async () => {
    const seen: string[] = [];
    const app = makeApp();
    const res = await app.request('/api/reminders', {}, { DB: makeDb(seen) });
    expect(res.status).toBe(200);
    // 並びの決め方が2か所に散らないよう、こちらは db 側の関数を通す。
    expect(mocks.getReminders).toHaveBeenCalled();
  });
});
