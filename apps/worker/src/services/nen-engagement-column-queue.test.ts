import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  getNenCampaign: vi.fn(),
  jstNow: vi.fn(() => '2026-08-28 01:00:00'),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./event-bus.js', () => ({ logOutgoingMessage: vi.fn().mockResolvedValue(undefined) }));

const { queueColumnDelivery } = await import('./nen-engagement.js');

const campaign = {
  campaign_key: 'column', label: 'NENコラム', category: 'column', trigger_event: 'column.scheduled',
  delay_days: 0, delivery_time: '10:00', is_enabled: 1, title: '見出し', body_text: '本文',
  button_label: null, button_url: null, image_url: null,
};

const column = {
  id: 'column-1', title: '歯みがきのコツ', excerpt: '概要', article_url: 'https://example.com/a',
  image_url: null, intro_text: '紹介文', target_mode: 'all', target_tag_id: null,
};

function createDb(friendCount: number, store = new Set<string>()) {
  const batchSizes: number[] = [];
  const friends = Array.from({ length: friendCount }, (_, index) => ({ id: `friend-${index}` }));
  const db = {
    prepare(sql: string) {
      const statement = {
        values: [] as unknown[],
        bind(...bound: unknown[]) { statement.values = bound; return statement; },
        async all() {
          if (sql.includes('FROM friends f')) return { results: friends };
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM nen_columns')) return column;
          if (sql.includes('FROM nen_campaign_settings')) return campaign;
          return null;
        },
        async run() {
          // 予約行の INSERT は batch 専用。最後の状態更新(UPDATE)だけ直接書く。
          if (sql.includes('INSERT OR IGNORE INTO nen_delivery_jobs')) {
            throw new Error('1件ずつの書き込みは使わない。batch でまとめる');
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ values: unknown[] }>) {
      batchSizes.push(statements.length);
      return statements.map((statement) => {
        // INSERT OR IGNORE の再現: 同じ友だちへの2回目は changes 0。
        const friendId = String(statement.values[1]);
        if (store.has(friendId)) return { success: true, meta: { changes: 0 } };
        store.add(friendId);
        return { success: true, meta: { changes: 1 } };
      });
    },
  } as unknown as D1Database;
  return { db, batchSizes };
}

describe('コラム配信予約のまとめ書き(点検 #512 の中1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getNenCampaign.mockResolvedValue(campaign);
  });

  it('250人でも3回の呼び出しで予約し、件数を返す', async () => {
    const { db, batchSizes } = createDb(250);
    const queued = await queueColumnDelivery(db, 'column-1', 'account-a', '2026-09-08 10:00:00');
    expect(queued).toBe(250);
    expect(batchSizes).toEqual([100, 100, 50]);
  });

  it('対象がいなければ書き込まない', async () => {
    const { db, batchSizes } = createDb(0);
    const queued = await queueColumnDelivery(db, 'column-1', 'account-a', '2026-09-08 10:00:00');
    expect(queued).toBe(0);
    expect(batchSizes).toEqual([]);
  });

  it('2回目の予約は重複せず 0 件になる(INSERT OR IGNORE)', async () => {
    const store = new Set<string>();
    const first = createDb(3, store);
    expect(await queueColumnDelivery(first.db, 'column-1', 'account-a', '2026-09-08 10:00:00')).toBe(3);
    const second = createDb(3, store);
    expect(await queueColumnDelivery(second.db, 'column-1', 'account-a', '2026-09-08 10:00:00')).toBe(0);
    expect(second.batchSizes).toEqual([3]);
  });
});
