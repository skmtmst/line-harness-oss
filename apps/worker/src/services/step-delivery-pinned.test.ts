import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  createScenario,
  createScenarioStep,
  enrollFriendInScenario,
  publishScenarioVersion,
  updateScenarioStep,
} from '@line-crm/db';
import { processStepDeliveries } from './step-delivery';

// 文面パリティ装飾だけモック（中身の同一性は既存の decoration テストが
// 保証）。LINE 送信は偽クライアントで受け、DB は本物を使う。
vi.mock('./auto-track.js', () => ({
  decorateForFriendPush: vi.fn(async (_db: unknown, messageType: string, content: string) => ({
    messageType,
    content,
  })),
}));

/*
 * シナリオに持ち主アカウントがあるときは、配信がそのアカウントの資格情報で
 * 新しい LineClient を作る（渡した偽クライアントを通らない）。外へ通信させ
 * ないよう、そちらの送信も受け取れるようにする。
 */
const accountSends = vi.hoisted(() => [] as Array<{ target: string; messages: unknown[] }>);
vi.mock('@line-crm/line-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/line-sdk')>();
  return {
    ...actual,
    LineClient: class {
      async pushMessage(target: string, messages: unknown[]) {
        accountSends.push({ target, messages });
        return {};
      }
    },
  };
});

function pushHarness() {
  const sent: Array<{ target: string; messages: unknown[] }> = [];
  const client = {
    pushMessage: vi.fn(async (target: string, messages: unknown[]) => {
      sent.push({ target, messages });
      return {};
    }),
  };
  return { sent, client };
}

/**
 * cron 配信の版固定（#644）の実D1テスト。
 *
 * 既存購読・同時公開・部分失敗・通削除・欠損参照・template 編集を、
 * 本物の SQLite（bootstrap 適用）で確かめる。
 */
describe('processStepDeliveries の版固定（実D1）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    accountSends.length = 0;
    vi.clearAllMocks();
  });

  async function seedPublished() {
    const scenario = await createScenario(testDb.db, { name: '案内', triggerType: 'manual' });
    const step1 = await createScenarioStep(testDb.db, {
      scenarioId: scenario.id,
      stepOrder: 0,
      messageType: 'text',
      messageContent: '1通目',
    });
    await createScenarioStep(testDb.db, {
      scenarioId: scenario.id,
      stepOrder: 1,
      messageType: 'text',
      messageContent: '2通目',
    });
    insertFriend(testDb.raw, 'friend-1', { line_user_id: 'U-friend-1' });
    await publishScenarioVersion(testDb.db, scenario.id, { staffId: null, idempotencyKey: 'cron-k1' });
    const enrollment = (await enrollFriendInScenario(testDb.db, 'friend-1', scenario.id))!;
    return { scenario, step1, enrollment };
  }

  it('下書き編集のあとも固定版の文面を送る', async () => {
    const { scenario, step1 } = await seedPublished();
    await updateScenarioStep(testDb.db, step1.id, { message_content: '書き換えた1通目' });

    const { sent, client } = pushHarness();
    await processStepDeliveries(testDb.db, client as never);

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].messages)).toContain('1通目');
    expect(JSON.stringify(sent[0].messages)).not.toContain('書き換えた1通目');
    void scenario;
  });

  it('下書きの通を消しても固定版を送り、ログと進行を壊さない', async () => {
    const { step1, enrollment } = await seedPublished();
    testDb.raw.prepare(`DELETE FROM scenario_steps WHERE id = ?`).run(step1.id);

    const { sent, client } = pushHarness();
    await processStepDeliveries(testDb.db, client as never);

    // 固定版の1通目が送られる。
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].messages)).toContain('1通目');
    // ログは残り、live の通参照は NULL、版所有の通IDで二重送信防止が効く。
    const log = testDb.raw
      .prepare(
        `SELECT scenario_step_id AS live, scenario_version_step_id AS pinned, source FROM messages_log WHERE friend_id = 'friend-1'`,
      )
      .get() as { live: string | null; pinned: string | null; source: string };
    expect(log.source).toBe('scenario');
    expect(log.live).toBeNull();
    expect(log.pinned).toBe(`${enrollment.published_version_id}:0`);
    // 購読は次へ進んでいる（cron が再送しない）。
    const row = testDb.raw
      .prepare(`SELECT current_step_order AS o, status FROM friend_scenarios WHERE id = ?`)
      .get(enrollment.id) as { o: number; status: string };
    expect(row.o).toBe(0);
    expect(row.status).toBe('active');
  });

  it('版が欠損しているときは送らず一時停止する', async () => {
    const { enrollment } = await seedPublished();
    testDb.raw.exec('DROP TRIGGER trg_scenario_versions_immutable_delete');
    testDb.raw.prepare(`DELETE FROM scenario_versions WHERE id = ?`).run(enrollment.published_version_id);

    const { sent, client } = pushHarness();
    await processStepDeliveries(testDb.db, client as never);

    expect(sent).toHaveLength(0);
    const row = testDb.raw
      .prepare(`SELECT status FROM friend_scenarios WHERE id = ?`)
      .get(enrollment.id) as { status: string };
    expect(row.status).toBe('paused');
  });

  it('公開後の template 編集は固定版へ混入しない', async () => {
    const scenario = await createScenario(testDb.db, { name: '案内', triggerType: 'manual' });
    // template の解決は「公開版があり、持ち主が両方はっきりしていて一致する」
    // ときだけ通る（#645）。その条件を満たす形で置く。
    //
    // シナリオ側の持ち主は friends 経由で決まる（scenarios.line_account_id を
    // 直に入れると、cron が実アカウントの資格情報で送りにいってしまい、
    // この検査（文面が固定されるか）と関係ないところで落ちる）。
    testDb.raw
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES ('acc-1', 'ch-1', '店舗1', 'tok-1', 'sec-1')`,
      )
      .run();
    testDb.raw
      .prepare(`UPDATE scenarios SET line_account_id = 'acc-1' WHERE id = ?`)
      .run(scenario.id);
    testDb.raw
      .prepare(
        `INSERT INTO templates (id, name, message_type, message_content, published_version, line_account_id)
         VALUES ('tpl-7', '案内', 'text', '公開時の文面', 1, 'acc-1')`,
      )
      .run();
    await createScenarioStep(testDb.db, {
      scenarioId: scenario.id,
      stepOrder: 0,
      messageType: 'text',
      messageContent: '控え',
      templateId: 'tpl-7',
    });
    insertFriend(testDb.raw, 'friend-1', { line_user_id: 'U-friend-1' });
    await publishScenarioVersion(testDb.db, scenario.id, { staffId: null, idempotencyKey: 'cron-t1' });
    await enrollFriendInScenario(testDb.db, 'friend-1', scenario.id);

    testDb.raw.prepare(`UPDATE templates SET message_content = '書き換えた文面' WHERE id = 'tpl-7'`).run();

    const { client } = pushHarness();
    await processStepDeliveries(testDb.db, client as never);

    // 持ち主アカウントの資格情報で送るので、受け口はこちら。
    expect(accountSends).toHaveLength(1);
    expect(JSON.stringify(accountSends[0].messages)).toContain('公開時の文面');
    expect(JSON.stringify(accountSends[0].messages)).not.toContain('書き換えた文面');
  });
});
