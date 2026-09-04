import { beforeEach, describe, expect, it, vi } from 'vitest';

const tagMocks = vi.hoisted(() => ({
  tags: new Map<string, Set<string>>(),
  attach: vi.fn(async (_db: D1Database, friendId: string, tagId: string) => {
    const tags = tagMocks.tags.get(friendId) ?? new Set<string>();
    const added = !tags.has(tagId);
    tags.add(tagId);
    tagMocks.tags.set(friendId, tags);
    return { added };
  }),
  detach: vi.fn(async (_db: D1Database, friendId: string, tagId: string) => {
    const tags = tagMocks.tags.get(friendId) ?? new Set<string>();
    const removed = tags.delete(tagId);
    tagMocks.tags.set(friendId, tags);
    return { removed };
  }),
}));
vi.mock('./friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: tagMocks.attach,
  detachTagAndFireSideEffects: tagMocks.detach,
}));

const { deriveEcTagIds, derivePetTagIds, NEN_TAG, refreshAllNenTags } =
  await import('./nen-tag-sync.js');

beforeEach(() => {
  tagMocks.tags.clear();
  tagMocks.attach.mockClear();
  tagMocks.detach.mockClear();
});

function queryCaptureDb() {
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const query = { sql, bindings: [] as unknown[] };
      queries.push(query);
      return {
        bind(...bindings: unknown[]) {
          query.bindings = bindings;
          return this;
        },
        async all() { return { results: [] }; },
      };
    },
  } as unknown as D1Database;
  return { db, queries };
}

function loadTestDb(friendCount: number, healthLogsPerFriend: number) {
  const friends = Array.from({ length: friendCount }, (_, index) => ({
    id: `friend-${String(index).padStart(4, '0')}`,
    user_id: `ec-${index}`,
  }));
  let state = { lastFriendId: '', cycleStartedAt: '2026-09-04T00:00:00.000Z' };
  let rowsRead = 0;
  const rowsReadByRun: number[] = [];
  const queries: string[] = [];

  const db = {
    prepare(sql: string) {
      queries.push(sql);
      let bindings: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { bindings = next; return statement; },
        async run() {
          if (sql.includes('UPDATE nen_tag_refresh_state')) {
            state = {
              lastFriendId: String(bindings[0]),
              cycleStartedAt: String(bindings[1]),
            };
            rowsReadByRun.push(rowsRead);
            rowsRead = 0;
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('FROM nen_tag_refresh_state')) {
            rowsRead += 1;
            return {
              last_friend_id: state.lastFriendId,
              cycle_started_at: state.cycleStartedAt,
            };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM friends')) {
            const after = String(bindings[0]);
            const limit = Number(bindings[1]);
            const rows = friends.filter((friend) => friend.id > after).slice(0, limit);
            rowsRead += rows.length;
            return { results: rows };
          }
          const friendIds = bindings.map(String).filter((value) => value.startsWith('friend-'));
          if (sql.includes('FROM nen_ec_member_snapshots')) {
            const rows = friendIds.map((friendId) => ({
              friend_id: friendId,
              customer_id: friendId,
              orders_json: '[]',
              subscription_json: null,
              purchase_count: 0,
              purchase_amount: 0,
              member_rank: '会員',
            }));
            rowsRead += rows.length;
            return { results: rows };
          }
          if (sql.includes('FROM nen_pet_profiles')) {
            const rows = friendIds.map((friendId) => ({
              friend_id: friendId,
              animal_type: 'dog',
              birthday: '2020-01-01',
              weight_kg: 8,
              concerns: '[]',
              image_url: null,
            }));
            rowsRead += rows.length;
            return { results: rows };
          }
          if (sql.includes('FROM nen_health_logs')) {
            const rows = friendIds.flatMap((friendId) => Array.from(
              { length: healthLogsPerFriend },
              (_, index) => ({
                friend_id: friendId,
                pet_id: `${friendId}-pet`,
                logged_on: `2026-09-${String(Math.max(1, 4 - (index % 3))).padStart(2, '0')}`,
                weight_kg: index === 0 ? 10 : 8,
                heart_rate_bpm: null,
                respiratory_rate_bpm: null,
              }),
            ));
            rowsRead += rows.length;
            return { results: rows };
          }
          if (sql.includes('FROM nen_care_flags')) {
            const rows = friendIds.map((friendId) => ({ friend_id: friendId, flag_type: 'poor_appetite' }));
            rowsRead += rows.length;
            return { results: rows };
          }
          if (sql.includes('FROM nen_photo_submissions')) return { results: [] };
          if (sql.includes('FROM friend_tags')) {
            const rows = friendIds.flatMap((friendId) => [...(tagMocks.tags.get(friendId) ?? [])]
              .map((tagId) => ({ friend_id: friendId, tag_id: tagId })));
            rowsRead += rows.length;
            return { results: rows };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, rowsReadByRun, queries, getState: () => state };
}

describe('NEN automatic tag rules', () => {
  const now = new Date('2026-08-11T03:00:00Z');

  it('replaces rank and purchase-state tags from the current EC totals', () => {
    const tags = deriveEcTagIds({
      customer_id: '33',
      orders_json: JSON.stringify([{ date: '2026-08-01T10:00:00+09:00', paymentMethod: 'Stripe credit card', items: [{ name: '毎日の鹿肉バランス4袋セット' }] }]),
      subscription_json: null,
      purchase_count: 3,
      purchase_amount: 52_000,
      member_rank: 'ゴールド会員',
    }, now);

    expect(tags).toEqual(expect.objectContaining(new Set([
      NEN_TAG.rankGold,
      NEN_TAG.purchaseExperienced,
      NEN_TAG.purchaseRepeat,
      NEN_TAG.purchaseRecent30,
      NEN_TAG.purchase20k,
      NEN_TAG.purchase50k,
      NEN_TAG.paymentCard,
      NEN_TAG.productBalance,
      NEN_TAG.productSet,
    ])));
    expect(tags.has(NEN_TAG.rankSilver)).toBe(false);
    expect(tags.has(NEN_TAG.purchaseNone)).toBe(false);
  });

  it('detects subscription status and a date within seven days', () => {
    const tags = deriveEcTagIds({
      customer_id: '33', orders_json: '[]', purchase_count: 0, purchase_amount: 0,
      member_rank: '会員',
      subscription_json: JSON.stringify({ contracts: [{ status: '契約中', next_shipping_date: '2026-08-17', items: [{ name: '鹿肉ミンチ定期便' }] }] }),
    }, now);

    expect(tags.has(NEN_TAG.subscriptionActive)).toBe(true);
    expect(tags.has(NEN_TAG.subscriptionNext7d)).toBe(true);
    expect(tags.has(NEN_TAG.subscriptionNone)).toBe(false);
    expect(tags.has(NEN_TAG.productSubscription)).toBe(true);
    expect(tags.has(NEN_TAG.productMince)).toBe(true);
  });

  it('aggregates multiple pets, birthday periods, size, age and concerns', () => {
    const tags = derivePetTagIds([
      { animal_type: 'dog', birthday: '2015-08-20', weight_kg: 8, concerns: '["tear_stain","allergy"]', image_url: 'https://example.com/dog.jpg' },
      { animal_type: 'cat', birthday: '2025-09-01', weight_kg: 4, concerns: '["weight"]', image_url: null },
    ], now);

    for (const tag of [
      NEN_TAG.petRegistered, NEN_TAG.petMultiple, NEN_TAG.petDog, NEN_TAG.petCat,
      NEN_TAG.petDogAndCat, NEN_TAG.petSmallDog, NEN_TAG.petSenior,
      NEN_TAG.petBirthdayThisMonth, NEN_TAG.petBirthdayNextMonth, NEN_TAG.petPhoto,
      NEN_TAG.concernTear, NEN_TAG.concernAllergy, NEN_TAG.concernWeight,
    ]) expect(tags.has(tag)).toBe(true);
    expect(tags.has(NEN_TAG.petUnregistered)).toBe(false);
  });

  it('marks a user with no pets as unregistered', () => {
    expect(derivePetTagIds([], now)).toEqual(new Set([NEN_TAG.petUnregistered]));
  });
});

describe('NEN bulk refresh scope', () => {
  it('500人×健康記録200件を複数回で完走し、各回の読込を1万行未満にする', async () => {
    const { db, rowsReadByRun, queries, getState } = loadTestDb(500, 200);
    let processed = 0;
    let calls = 0;
    let result;
    do {
      result = await refreshAllNenTags(
        db,
        { allTenants: true },
        500,
        new Date('2026-09-04T00:00:00.000Z'),
      );
      processed += result.friends;
      calls += 1;
    } while (result.hasMore);

    expect(processed).toBe(500);
    expect(calls).toBe(25);
    // state 1 + friend page 21 + EC 20 + pet 20 + health 4,000 + care 20 = 4,082行。
    expect(Math.max(...rowsReadByRun)).toBe(4_082);
    expect(getState().lastFriendId).toBe('');
    expect(queries.filter((sql) => sql.includes('FROM nen_health_logs'))).toHaveLength(25);
    const photoQuery = queries.find((sql) => sql.includes('FROM nen_photo_submissions'));
    expect(photoQuery).toBeDefined();
    expect(photoQuery).not.toContain('COUNT(*)');
    expect(photoQuery?.match(/EXISTS\s*\(/g)).toHaveLength(3);
    for (const friend of ['friend-0000', 'friend-0250', 'friend-0499']) {
      expect(tagMocks.tags.get(friend)).toEqual(expect.objectContaining(new Set([
        NEN_TAG.member,
        NEN_TAG.ecLinked,
        NEN_TAG.petRegistered,
        NEN_TAG.healthDiary,
        NEN_TAG.healthWeightLog,
        NEN_TAG.healthAppetiteCheck,
        NEN_TAG.actionDiaryContinued,
        NEN_TAG.healthWeightCheck,
        NEN_TAG.deliveryOrder,
      ])));
    }
  });

  it('タグ更新に失敗したときは友だちカーソルを進めない', async () => {
    const { db, getState } = loadTestDb(2, 0);
    tagMocks.attach.mockRejectedValueOnce(new Error('tag write failed'));

    await expect(refreshAllNenTags(
      db,
      { allTenants: true },
      500,
      new Date('2026-09-04T00:00:00.000Z'),
    )).rejects.toThrow('tag write failed');

    expect(getState()).toEqual({
      lastFriendId: '',
      cycleStartedAt: '2026-09-04T00:00:00.000Z',
    });
  });

  it('keeps account filtering when an explicit account list is requested', async () => {
    const { db, queries } = queryCaptureDb();

    await refreshAllNenTags(db, ['account-1', 'account-2', null], 500);

    expect(queries[0].sql).toContain('line_account_id IN (?,?)');
    expect(queries[0].sql).toContain('OR line_account_id IS NULL');
    expect(queries[0].bindings).toEqual(['account-1', 'account-2', 500]);
  });
});
