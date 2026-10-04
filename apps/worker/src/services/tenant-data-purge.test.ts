import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processTenantDataPurge } from './tenant-data-purge.js';

/*
 * 退会後の顧客データ削除（★V6 36-2）。
 *
 * 「消える」だけでなく「消えてはいけないものが残る」ことまで確かめる。
 * 条件は SQL そのものが仕様なので、手書きのモックではなく本物のSQLiteに当てる。
 */

const DAY = 24 * 60 * 60 * 1000;

function jst(offsetDays: number): string {
  // 2026-06-01 09:00 JST を基準にした相対時刻。実時刻に依らず結果が決まる。
  const base = Date.parse('2026-06-01T00:00:00.000Z');
  return new Date(base + offsetDays * DAY).toISOString();
}

/** 今回の実行時刻。保存期限(90日)の判定はここを基準にする。 */
const NOW = jst(0);

function createR2() {
  return { delete: vi.fn(async () => {}) } as unknown as R2Bucket & { delete: ReturnType<typeof vi.fn> };
}

describe('tenant data retention purge', () => {
  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createTestD1();
  });

  function seedTenant(
    id: string,
    retention: { anchor?: string | null; requested?: string | null; planStatus?: string; trialEndsAt?: string | null },
  ): void {
    sqlite.raw
      .prepare(
        `INSERT INTO tenants (id, name, plan_status, trial_ends_at, retention_anchor_at, purge_requested_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        `統括 ${id}`,
        retention.planStatus ?? 'canceled',
        retention.trialEndsAt ?? null,
        retention.anchor ?? null,
        retention.requested ?? null,
      );
    sqlite.raw
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
         VALUES (?, ?, ?, 'token', 'secret', ?)`,
      )
      .run(`acc-${id}`, `channel-${id}`, `アカウント ${id}`, id);
  }

  function seedFriends(tenantId: string, count: number, prefix = 'u'): void {
    const insert = sqlite.raw.prepare(
      'INSERT INTO friends (id, line_user_id, line_account_id) VALUES (?, ?, ?)',
    );
    const many = sqlite.raw.transaction((total: number) => {
      for (let index = 0; index < total; index += 1) {
        insert.run(`${prefix}-${tenantId}-${index}`, `line-${prefix}-${tenantId}-${index}`, `acc-${tenantId}`);
      }
    });
    many(count);
  }

  function seedMedia(tenantId: string, r2Key: string): void {
    sqlite.raw
      .prepare(
        `INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, line_account_id)
         VALUES (?, 'image', 'a.png', 'image/png', 10, ?, ?)`,
      )
      .run(`media-${tenantId}`, r2Key, `acc-${tenantId}`);
  }

  /** 監査・支払の記録。削除対象に入れてはいけない。 */
  function seedInvoice(tenantId: string): void {
    sqlite.raw
      .prepare(
        `INSERT INTO billing_invoices (id, tenant_id, synced_at, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(`inv-${tenantId}`, tenantId, NOW, NOW);
  }

  function count(table: string, where: string, ...args: unknown[]): number {
    const row = sqlite.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args as never[]);
    return (row as { n: number }).n;
  }

  test('保存期限(90日)が過ぎた統括の顧客データとR2画像を消し、支払の記録は残す', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedFriends('t1', 3);
    seedMedia('t1', 'images/t1.png');
    seedInvoice('t1');

    const IMAGES = createR2();
    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW });

    expect(result.tenants).toBe(1);
    expect(result.completed).toBe(1);
    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(0);
    expect(count('media', 'line_account_id = ?', 'acc-t1')).toBe(0);
    // 支払の記録は retain。統括に紐づいていても消さない。
    expect(count('billing_invoices', 'tenant_id = ?', 't1')).toBe(1);
    // R2の実体も消す。
    expect(IMAGES.delete).toHaveBeenCalledWith(['images/t1.png']);
    expect(result.deletedObjects).toBe(1);
  });

  test('削除の実績が監査表に残り、統括に削除済みの印が付く', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedFriends('t1', 2);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    const audit = sqlite.raw
      .prepare('SELECT * FROM tenant_data_purge_audit WHERE tenant_id = ?')
      .get('t1') as {
        reason: string;
        finished_at: string | null;
        deleted_rows: number;
        deleted_rows_by_table: string;
      };
    expect(audit.reason).toBe('expired');
    expect(audit.finished_at).not.toBeNull();
    expect(audit.deleted_rows).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(audit.deleted_rows_by_table).friends).toBe(2);

    const tenant = sqlite.raw.prepare('SELECT data_purged_at FROM tenants WHERE id = ?').get('t1') as {
      data_purged_at: string | null;
    };
    expect(tenant.data_purged_at).not.toBeNull();
  });

  test('保存期限内の統括は消さない', async () => {
    seedTenant('t1', { anchor: jst(-89) });
    seedFriends('t1', 2);

    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(result.tenants).toBe(0);
    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(2);
  });

  test('早期削除の要請があれば90日を待たずに消し、理由をimmediateで残す', async () => {
    seedTenant('t1', { anchor: jst(-3), requested: jst(-1) });
    seedFriends('t1', 2);

    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(result.completed).toBe(1);
    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(0);
    const audit = sqlite.raw
      .prepare('SELECT reason FROM tenant_data_purge_audit WHERE tenant_id = ?')
      .get('t1') as { reason: string };
    expect(audit.reason).toBe('immediate');
  });

  test('1回の行数に上限があり、途中で止まっても次の回が続きから消す', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    // 1回の上限(5000行)を超える量。1回目では消し切れない。
    seedFriends('t1', 5001);

    const first = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });
    expect(first.deletedRows).toBe(5000);
    expect(first.completed).toBe(0);
    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(1);
    // 消し終えていないので印は付かず、次の回も同じ統括が対象になる。
    const midway = sqlite.raw.prepare('SELECT data_purged_at FROM tenants WHERE id = ?').get('t1') as {
      data_purged_at: string | null;
    };
    expect(midway.data_purged_at).toBeNull();
    const midAudit = sqlite.raw
      .prepare('SELECT finished_at FROM tenant_data_purge_audit WHERE tenant_id = ?')
      .get('t1') as { finished_at: string | null };
    expect(midAudit.finished_at).toBeNull();

    const second = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });
    expect(second.completed).toBe(1);
    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(0);
  });

  test('無料体験が終わったままの統括に、体験終了の時刻を起点として入れる', async () => {
    const trialEndsAt = jst(-10);
    seedTenant('t1', { planStatus: 'trialing', trialEndsAt, anchor: null });

    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(result.anchoredTrials).toBe(1);
    const tenant = sqlite.raw.prepare('SELECT retention_anchor_at FROM tenants WHERE id = ?').get('t1') as {
      retention_anchor_at: string | null;
    };
    // 点検した時刻ではなく、実際に体験が終わった時刻を起点にする。
    expect(tenant.retention_anchor_at).toBe(trialEndsAt);
    // まだ90日経っていないので削除はしない。
    expect(result.tenants).toBe(0);
  });

  test('他の統括のデータは消さない', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedFriends('t1', 2);
    seedTenant('t2', { anchor: null, planStatus: 'active' });
    seedFriends('t2', 2);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(count('friends', 'line_account_id = ?', 'acc-t1')).toBe(0);
    expect(count('friends', 'line_account_id = ?', 'acc-t2')).toBe(2);
  });

  /*
   * 回答フォームの消し残し直し。
   *
   * 以前はタグ経由で探していたので、タグを付けていないフォーム（付けないのが
   * 普通）は条件に一致せず残り続けていた。今は利用アカウント経由で探す。
   * フォームは複数の店で使い回すことがあるので、統括をまたいで使われている
   * 物はどちらの統括の削除でも消さない。所属の無い物も消さない。
   */
  function seedTag(id: string, accountId: string): void {
    sqlite.raw
      .prepare(`INSERT INTO tags (id, name, line_account_id) VALUES (?, ?, ?)`)
      .run(id, `タグ ${id}`, accountId);
  }

  function seedForm(id: string, tagId: string | null, accountIds: string[]): void {
    // 公開版は INSERT のトリガが作る（手で足すと版番号が重なる）。
    sqlite.raw
      .prepare(`INSERT INTO forms (id, name, on_submit_tag_id) VALUES (?, ?, ?)`)
      .run(id, `フォーム ${id}`, tagId);
    const link = sqlite.raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES (?, ?)`);
    for (const accountId of accountIds) link.run(id, accountId);
  }

  function formCount(where: string, ...args: unknown[]): number {
    return count('forms', where, ...args);
  }

  test('タグを付けていないフォームも消える（子の版も一緒に）', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedForm('f1', null, ['acc-t1']);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(formCount('id = ?', 'f1')).toBe(0);
    expect(count('form_versions', 'form_id = ?', 'f1')).toBe(0);
    expect(count('form_accounts', 'form_id = ?', 'f1')).toBe(0);
  });

  test('タグを付けているフォームも今までどおり消える', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedTag('tag-1', 'acc-t1');
    seedForm('f1', 'tag-1', ['acc-t1']);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(formCount('id = ?', 'f1')).toBe(0);
  });

  test('ほかの店のフォームは消えない', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedTenant('t2', { anchor: null, planStatus: 'active' });
    seedForm('f1', null, ['acc-t1']);
    seedForm('f2', null, ['acc-t2']);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    expect(formCount('id = ?', 'f1')).toBe(0);
    expect(formCount('id = ?', 'f2')).toBe(1);
  });

  test('統括をまたいで使うフォームはどちらの削除でも消さない', async () => {
    seedTenant('t1', { anchor: jst(-91) });
    seedTenant('t2', { anchor: null, planStatus: 'active' });
    // 両方の統括の店で使う1つのフォーム。
    seedForm('shared', null, ['acc-t1', 'acc-t2']);

    await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });

    // 本体は残る。t1 側の利用だけ外れ、t2 側の利用は残る。
    expect(formCount('id = ?', 'shared')).toBe(1);
    expect(count('form_accounts', 'form_id = ? AND line_account_id = ?', 'shared', 'acc-t1')).toBe(0);
    expect(count('form_accounts', 'form_id = ? AND line_account_id = ?', 'shared', 'acc-t2')).toBe(1);
  });
});
