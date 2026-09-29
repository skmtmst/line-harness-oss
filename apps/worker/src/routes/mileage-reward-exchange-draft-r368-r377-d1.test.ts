/*
 * m22w 監査 R368〜R377：マイル特典の交換条件・公開期間・在庫・下書きと公開。
 *
 * 監査は固定SHAの合成記録で「未照合」だったため、ここでは最新の本線の
 * 実SQLite＋実D1層で1件ずつ再現を確認し、直しの前後を固定する。
 * 直しを戻すと赤くなる形（逆変異で確認）にしている。
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  createMileageRewardDraft,
  createMileageRewardDraftFromPublished,
  getMileageReward,
  getMileageRewardDeliveryPlan,
  importMileageRewardCodes,
  MileageRewardError,
  publishMileageReward,
  reserveMileageRewardRedemption,
  updateMileageRewardDraft,
  type MileageRewardDraftInput,
} from '@line-crm/db';

import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { scoring } from './scoring';

const tenantOwner: AuthenticatedStaff = {
  id: 'owner-1', name: '統括のオーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(db: D1Database, staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', scoring);
  return instance;
}

function seedAccount(testDb: SqliteD1, accountId: string): void {
  testDb.raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', 1, 'tenant-1')`,
  ).run(accountId, `channel-${accountId}`, `公式${accountId}`);
  testDb.raw.prepare(
    `INSERT OR IGNORE INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', '統括のオーナー', 'owner', 'key-owner-1', 'tenant-1', 'all')`,
  ).run();
}

function seedFriend(
  testDb: SqliteD1,
  accountId: string,
  suffix: string,
  options?: { miles?: number; following?: boolean },
): { friendId: string; beneficiaryKey: string } {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO users (id, display_name) VALUES (?, ?)`).run(`user-${suffix}`, `利用者${suffix}`);
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, line_account_id, is_following)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    `friend-${suffix}`, `U-${suffix}`, `利用者${suffix}`, `user-${suffix}`, accountId,
    options?.following === false ? 0 : 1,
  );
  const miles = options?.miles ?? 240;
  raw.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
        amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
     VALUES (?, 'default', ?, ?, 'grant', 'available', ?, '初期付与', 'test', ?, ?, '{}',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run(`grant-${suffix}`, `user-${suffix}`, `friend-${suffix}`, miles, `event-${suffix}`, `grant-${suffix}`);
  return { friendId: `friend-${suffix}`, beneficiaryKey: `user:user-${suffix}` };
}

function seedTag(testDb: SqliteD1, accountId: string, tagId: string): void {
  testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES (?, ?, ?)`)
    .run(tagId, `タグ${tagId}`, accountId);
}

function tagFriend(testDb: SqliteD1, friendId: string, tagId: string): void {
  testDb.raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES (?, ?)`).run(friendId, tagId);
}

/** tag種の公開に要る交換後アクションの公開版。 */
function seedAction(testDb: SqliteD1, accountId: string, suffix: string): string {
  testDb.raw.prepare(
    `INSERT INTO common_actions (id, line_account_id, name, status, current_published_version_id)
     VALUES (?, ?, ?, 'published', ?)`,
  ).run(`action-${suffix}`, accountId, `アクション${suffix}`, `action-version-${suffix}`);
  testDb.raw.prepare(
    `INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config, published_at)
     VALUES (?, ?, 1, 'published', ?, '2026-08-01T00:00:00.000Z')`,
  ).run(
    `action-version-${suffix}`,
    `action-${suffix}`,
    JSON.stringify([{ id: 'm1', type: 'message', params: { text: 'ok' } }]),
  );
  return `action-version-${suffix}`;
}

function couponDraft(extra?: Partial<MileageRewardDraftInput>): MileageRewardDraftInput {
  return { name: '使い道', rewardKind: 'coupon', requiredMiles: 60, ...extra };
}

async function publishCoupon(
  testDb: SqliteD1,
  accountId: string,
  codes: string[],
  extra?: Partial<MileageRewardDraftInput>,
): Promise<string> {
  const draft = await createMileageRewardDraft(testDb.db, { lineAccountId: accountId, draft: couponDraft(extra) });
  await importMileageRewardCodes(testDb.db, {
    rewardId: draft.id,
    lineAccountId: accountId,
    codes: codes.map((code) => ({ ciphertext: `enc-${code}`, fingerprint: `fp-${code}` })),
  });
  await publishMileageReward(testDb.db, { id: draft.id, lineAccountId: accountId });
  return draft.id;
}

function walletOf(testDb: SqliteD1, beneficiaryKey: string): number | null {
  const row = testDb.raw.prepare(
    `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = ?`,
  ).get(beneficiaryKey) as { available: number } | undefined;
  return row?.available ?? null;
}

function redemptionCount(testDb: SqliteD1, rewardId: string): number {
  const row = testDb.raw.prepare(
    `SELECT COUNT(*) AS count FROM mileage_redemptions WHERE reward_id = ? AND status != 'refunded'`,
  ).get(rewardId) as { count: number };
  return row.count;
}

async function reserveError(
  testDb: SqliteD1,
  input: { accountId: string; friendId: string; rewardId: string; key: string },
): Promise<MileageRewardError> {
  try {
    await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: input.accountId,
      friendId: input.friendId,
      rewardId: input.rewardId,
      idempotencyKey: input.key,
      requestFingerprint: `fp-${input.key}`,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(MileageRewardError);
    return error as MileageRewardError;
  }
  throw new Error(`交換が通ってしまった: ${input.key}`);
}

describe('R368 交換対象条件に合わない友だちへ渡さない', () => {
  it('タグのない友だちは交換前に断り、残高・在庫を動かさない', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    seedTag(testDb, 'account-1', 'tag-vip');
    const noTag = seedFriend(testDb, 'account-1', 'notag');
    const tagged = seedFriend(testDb, 'account-1', 'vip');
    tagFriend(testDb, tagged.friendId, 'tag-vip');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1'], {
      targetConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-vip' }] },
    });

    const error = await reserveError(testDb, {
      accountId: 'account-1', friendId: noTag.friendId, rewardId, key: 'r368-no-tag',
    });
    expect(error.code).toBe('reward_not_eligible');
    expect(walletOf(testDb, noTag.beneficiaryKey)).toBe(240);
    expect(redemptionCount(testDb, rewardId)).toBe(0);
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_reward_codes WHERE status = 'available'`,
    ).get() as { count: number }).toEqual({ count: 1 });

    const ok = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: tagged.friendId, rewardId,
      idempotencyKey: 'r368-tag-ok', requestFingerprint: 'fp-r368-tag-ok',
    });
    expect(ok.kind).toBe('created');
    expect(walletOf(testDb, tagged.beneficiaryKey)).toBe(180);
  });

  it('フォロー中のみの条件でフォロー外を断り、ORの組合せも守る', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    seedTag(testDb, 'account-1', 'tag-vip');
    const unfollowed = seedFriend(testDb, 'account-1', 'unfollowed', { following: false });
    const followed = seedFriend(testDb, 'account-1', 'followed');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1'], {
      targetConditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] },
    });
    expect((await reserveError(testDb, {
      accountId: 'account-1', friendId: unfollowed.friendId, rewardId, key: 'r368-unfollowed',
    })).code).toBe('reward_not_eligible');
    expect(walletOf(testDb, unfollowed.beneficiaryKey)).toBe(240);

    const orReward = await publishCoupon(testDb, 'account-1', ['code-2'], {
      name: 'OR条件',
      targetConditions: {
        operator: 'OR',
        rules: [{ type: 'tag_exists', value: 'tag-vip' }, { type: 'is_following', value: true }],
      },
    });
    // どちらも満たさない友だちは断る。
    expect((await reserveError(testDb, {
      accountId: 'account-1', friendId: unfollowed.friendId, rewardId: orReward, key: 'r368-or-no',
    })).code).toBe('reward_not_eligible');
    // 片方を満たす友だちは通す。
    const ok = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: followed.friendId, rewardId: orReward,
      idempotencyKey: 'r368-or-ok', requestFingerprint: 'fp-r368-or-ok',
    });
    expect(ok.kind).toBe('created');
  });
});

describe('R369 時差付き日時でも公開期間の判定がずれない', () => {
  /** UTCの瞬間を +09:00 表記にする。 */
  function plus0900(instantMs: number): string {
    return new Date(instantMs + 9 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+09:00');
  }

  it('同じ瞬間は表記が違っても同じ保存値になり、逆転期間は拒否する', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const instant = '2026-09-28T11:00:00.000Z';
    const created = await createMileageRewardDraft(testDb.db, {
      lineAccountId: 'account-1',
      draft: couponDraft({ startsAt: '2026-09-28T20:00:00+09:00' }),
    });
    expect(created.currentVersion?.startsAt).toBe(instant);

    await expect(createMileageRewardDraft(testDb.db, {
      lineAccountId: 'account-1',
      draft: couponDraft({ startsAt: '2026-09-28T12:00:00Z', endsAt: '2026-09-28T20:00:00+09:00' }),
    })).rejects.toMatchObject({ code: 'invalid_period' });
  });

  it('開始直前は断り、開始後は受け付ける', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const friend = seedFriend(testDb, 'account-1', 'period');
    const futureId = await publishCoupon(testDb, 'account-1', ['code-future'], {
      startsAt: plus0900(Date.now() + 3_600_000),
    });
    expect((await reserveError(testDb, {
      accountId: 'account-1', friendId: friend.friendId, rewardId: futureId, key: 'r369-future',
    })).code).toBe('reward_outside_period');
    expect(walletOf(testDb, friend.beneficiaryKey)).toBe(240);

    const pastId = await publishCoupon(testDb, 'account-1', ['code-past'], {
      startsAt: plus0900(Date.now() - 3_600_000),
    });
    const ok = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: friend.friendId, rewardId: pastId,
      idempotencyKey: 'r369-past', requestFingerprint: 'fp-r369-past',
    });
    expect(ok.kind).toBe('created');
  });
});

describe('R370 在庫があるのに片方へ在庫なしを返さない', () => {
  it('在庫2個・別々の友だちは各1回成功して異なるコードを渡す', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const first = seedFriend(testDb, 'account-1', 'first');
    const second = seedFriend(testDb, 'account-1', 'second');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-a', 'code-b']);

    const firstReserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: first.friendId, rewardId,
      idempotencyKey: 'r370-first', requestFingerprint: 'fp-r370-first',
    });
    const secondReserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: second.friendId, rewardId,
      idempotencyKey: 'r370-second', requestFingerprint: 'fp-r370-second',
    });
    expect(firstReserved.redemption.rewardCodeId).not.toBe(secondReserved.redemption.rewardCodeId);
    expect(walletOf(testDb, first.beneficiaryKey)).toBe(180);
    expect(walletOf(testDb, second.beneficiaryKey)).toBe(180);
  });

  it('在庫1個は1人だけ成功し、失敗側の残高は変わらず再実行でも消費しない', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const winner = seedFriend(testDb, 'account-1', 'winner');
    const loser = seedFriend(testDb, 'account-1', 'loser');
    const rewardId = await publishCoupon(testDb, 'account-1', ['only-code']);

    await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: winner.friendId, rewardId,
      idempotencyKey: 'r370-winner', requestFingerprint: 'fp-r370-winner',
    });
    expect((await reserveError(testDb, {
      accountId: 'account-1', friendId: loser.friendId, rewardId, key: 'r370-loser',
    })).code).toBe('out_of_stock');
    expect(walletOf(testDb, loser.beneficiaryKey)).toBe(240);
    expect(redemptionCount(testDb, rewardId)).toBe(1);
    // 同じ処理IDの再実行でも消費しない。
    expect((await reserveError(testDb, {
      accountId: 'account-1', friendId: loser.friendId, rewardId, key: 'r370-loser',
    })).code).toBe('out_of_stock');
    expect(walletOf(testDb, loser.beneficiaryKey)).toBe(240);
  });
});

describe('R371 下書きを作っても公開中の交換は止まらない', () => {
  it('未公開の下書きがあっても旧公開版で交換できる', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const friend = seedFriend(testDb, 'account-1', 'buyer');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1', 'code-2']);

    const draft = await createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    });
    expect(draft.currentDraftVersionId).not.toBeNull();

    const ok = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: friend.friendId, rewardId,
      idempotencyKey: 'r371-ok', requestFingerprint: 'fp-r371-ok',
    });
    expect(ok.kind).toBe('created');
    const published = await getMileageReward(testDb.db, { id: rewardId, lineAccountId: 'account-1' });
    expect(ok.redemption.rewardVersionId).toBe(published?.currentPublishedVersionId);
    expect(walletOf(testDb, friend.beneficiaryKey)).toBe(180);
  });
});

describe('R372 配布済みコードを新版・別特典へ再登録しない', () => {
  it('渡したコードの再取り込みは増えず、別の利用者へ同じコードを配らない', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const first = seedFriend(testDb, 'account-1', 'first');
    const second = seedFriend(testDb, 'account-1', 'second');
    const rewardId = await publishCoupon(testDb, 'account-1', ['shared-code']);

    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: first.friendId, rewardId,
      idempotencyKey: 'r372-first', requestFingerprint: 'fp-r372-first',
    });
    // 配布まで進んだ扱いにする。
    testDb.raw.prepare(
      `UPDATE mileage_reward_codes SET status = 'issued', issued_at = ? WHERE id = ?`,
    ).run('2026-09-28T00:00:00.000Z', reserved.redemption.rewardCodeId);

    await createMileageRewardDraftFromPublished(testDb.db, { id: rewardId, lineAccountId: 'account-1' });
    const reimport = await importMileageRewardCodes(testDb.db, {
      rewardId, lineAccountId: 'account-1',
      codes: [
        { ciphertext: 'enc-shared-code', fingerprint: 'fp-shared-code' },
        { ciphertext: 'enc-fresh-code', fingerprint: 'fp-fresh-code' },
      ],
    });
    expect(reimport.inserted).toBe(1);

    // 同じ版への二重取り込みも増えない。
    const duplicate = await importMileageRewardCodes(testDb.db, {
      rewardId, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'enc-fresh-code', fingerprint: 'fp-fresh-code' }],
    });
    expect(duplicate.inserted).toBe(0);

    const published = await publishMileageReward(testDb.db, { id: rewardId, lineAccountId: 'account-1' });
    const secondReserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: second.friendId, rewardId,
      idempotencyKey: 'r372-second', requestFingerprint: 'fp-r372-second',
    });
    expect(secondReserved.redemption.rewardVersionId).toBe(published.currentPublishedVersionId);
    expect(secondReserved.redemption.rewardCodeId).not.toBe(reserved.redemption.rewardCodeId);
  });
});

describe('R373 未公開の種類・名前変更が処理中・成功済みの交換へ混ざらない', () => {
  it('交換が参照した版の名前・種類を保つ', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const actionVersionId = seedAction(testDb, 'account-1', 'r373');
    const friend = seedFriend(testDb, 'account-1', 'buyer');
    const created = await createMileageRewardDraft(testDb.db, {
      lineAccountId: 'account-1',
      draft: {
        name: '旧名の特典', rewardKind: 'tag', requiredMiles: 60,
        commonActionVersionId: actionVersionId,
      },
    });
    await publishMileageReward(testDb.db, { id: created.id, lineAccountId: 'account-1' });

    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: friend.friendId, rewardId: created.id,
      idempotencyKey: 'r373-start', requestFingerprint: 'fp-r373-start',
    });

    // 未公開の下書きで種類と名前を変えても、開始済みの交換は旧版のまま。
    const draft = await createMileageRewardDraftFromPublished(testDb.db, {
      id: created.id, lineAccountId: 'account-1',
    });
    await updateMileageRewardDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedVersionId: draft.currentDraftVersionId!,
      expectedRevision: draft.currentVersion!.revision,
      draft: { name: '新名の特典', rewardKind: 'coupon', requiredMiles: 60 },
    });
    const plan = await getMileageRewardDeliveryPlan(testDb.db, reserved.redemption.id);
    expect(plan.rewardName).toBe('旧名の特典');
    expect(plan.rewardKind).toBe('tag');
  });
});

describe('R374 古い更新番号の保存は先の変更を消さない', () => {
  it('古い番号は409で止まり、取り直した編集は通る', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const created = await createMileageRewardDraft(testDb.db, {
      lineAccountId: 'account-1', draft: couponDraft({ requiredMiles: 60 }),
    });
    const first = await updateMileageRewardDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedVersionId: created.currentDraftVersionId!,
      expectedRevision: created.currentVersion!.revision,
      draft: couponDraft({ requiredMiles: 120 }),
    });
    expect(first.currentVersion?.requiredMiles).toBe(120);

    await expect(updateMileageRewardDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedVersionId: created.currentDraftVersionId!,
      expectedRevision: created.currentVersion!.revision,
      draft: couponDraft({ requiredMiles: 60 }),
    })).rejects.toMatchObject({ code: 'version_conflict' });

    const kept = await getMileageReward(testDb.db, { id: created.id, lineAccountId: 'account-1' });
    expect(kept?.currentVersion?.requiredMiles).toBe(120);
    const retry = await updateMileageRewardDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedVersionId: kept!.currentDraftVersionId!,
      expectedRevision: kept!.currentVersion!.revision,
      draft: couponDraft({ requiredMiles: 150 }),
    });
    expect(retry.currentVersion?.requiredMiles).toBe(150);
  });
});

describe('R375 別所属の下書き保存は失敗しても何も書き換えない', () => {
  it('HTTPで409/404を返し、相手の必要マイルも名前も不変', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    seedAccount(testDb, 'account-2');
    const target = app(testDb.db, tenantOwner);
    const victim = await createMileageRewardDraft(testDb.db, {
      lineAccountId: 'account-2', draft: couponDraft({ name: '相手の下書き', requiredMiles: 60 }),
    });

    const response = await target.request(`/api/mileage/rewards/${victim.id}/draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-1',
        expectedVersionId: victim.currentDraftVersionId,
        expectedRevision: victim.currentVersion!.revision,
        draft: couponDraft({ name: '相手の下書き', requiredMiles: 999 }),
      }),
    });
    expect([404, 409]).toContain(response.status);

    const kept = await getMileageReward(testDb.db, { id: victim.id, lineAccountId: 'account-2' });
    expect(kept?.name).toBe('相手の下書き');
    expect(kept?.currentVersion?.requiredMiles).toBe(60);
  });
});

describe('R376 検証後に別保存が入った公開は止まる', () => {
  it('古い更新番号の公開は409で止まり、確認した価格を保つ', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1'], { requiredMiles: 60 });

    const draft = await createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    });
    const staleRevision = draft.currentVersion!.revision;
    await updateMileageRewardDraft(testDb.db, {
      id: rewardId,
      lineAccountId: 'account-1',
      expectedVersionId: draft.currentDraftVersionId!,
      expectedRevision: staleRevision,
      draft: couponDraft({ requiredMiles: 120 }),
    });
    // 新版の下書きには在庫を引き継がないため、検証用に1件登録する。
    await importMileageRewardCodes(testDb.db, {
      rewardId, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'enc-code-2', fingerprint: 'fp-code-2' }],
    });

    // 検証時(60)の番号では公開できない。
    await expect(publishMileageReward(testDb.db, {
      id: rewardId, lineAccountId: 'account-1', expectedRevision: staleRevision,
    })).rejects.toMatchObject({ code: 'version_conflict' });
    const kept = await getMileageReward(testDb.db, { id: rewardId, lineAccountId: 'account-1' });
    expect(kept?.currentPublishedVersionId).toBe(draft.currentPublishedVersionId);
    expect(kept?.currentVersion?.status).toBe('draft');

    // 確認し直した番号では公開できる。
    const reread = await getMileageReward(testDb.db, { id: rewardId, lineAccountId: 'account-1' });
    const published = await publishMileageReward(testDb.db, {
      id: rewardId,
      lineAccountId: 'account-1',
      expectedVersionId: reread!.currentDraftVersionId,
      expectedRevision: reread!.currentVersion!.revision,
    });
    expect(published.currentVersion?.requiredMiles).toBe(120);
  });
});

describe('R377 同時作成でも500にせず競合を案内する', () => {
  it('2本目は読み直しの409で、下書きは1個', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1']);

    const first = await createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    });
    // もう1本が「下書きなし」を読んだ直後に割り込んだ扱いにする。
    testDb.raw.prepare(
      `UPDATE mileage_rewards SET current_draft_version_id = NULL WHERE id = ?`,
    ).run(rewardId);
    await expect(createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'draft_exists' });

    const versions = testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_reward_versions WHERE reward_id = ?`,
    ).get(rewardId) as { count: number };
    expect(versions).toEqual({ count: 2 });
    expect(first.currentDraftVersionId).not.toBeNull();
  });

  it('順番の作成は同じ下書きを返し、増やさない', async () => {
    const testDb = createTestD1();
    seedAccount(testDb, 'account-1');
    const rewardId = await publishCoupon(testDb, 'account-1', ['code-1']);

    const first = await createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    });
    const second = await createMileageRewardDraftFromPublished(testDb.db, {
      id: rewardId, lineAccountId: 'account-1',
    });
    expect(second.currentDraftVersionId).toBe(first.currentDraftVersionId);
  });
});
