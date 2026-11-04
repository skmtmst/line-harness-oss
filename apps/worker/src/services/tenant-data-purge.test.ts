import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processTenantDataPurge } from './tenant-data-purge.js';
import { claimMediaForSend } from '../features/media/send-claims.js';
import { serializeMedia } from '../routes/hq-banner-serializers.js';
import type { Media } from '@line-crm/db';

/*
 * 退会後の顧客データ削除（★36-2）。
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

  test('別統括の店が使用中の画像の保存期限削除を店と件数と理由で記録する', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedTenant('t2', { planStatus: 'active' });
    seedMedia('t1', 'images/t1.png');
    sqlite.raw.prepare("INSERT INTO events(id,line_account_id,name,image_url) VALUES('event-other','acc-t2','架空イベント','https://example.test/images/t1.png')").run();
    const IMAGES = createR2();
    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW });
    expect(result.completed).toBe(1);
    expect(IMAGES.delete).toHaveBeenCalledWith(['images/t1.png']);
    const records = sqlite.raw.prepare("SELECT line_account_id, reason, after_json FROM audit_events WHERE action='media_removed_cross_tenant'").all() as Array<{line_account_id:string;reason:string;after_json:string}>;
    expect(records.map(row => ({ account:row.line_account_id, reason:row.reason, count:JSON.parse(row.after_json).usageCount })))
      .toContainEqual({ account:'acc-t2', reason:'CROSS_TENANT_MEDIA_REMOVED', count:1 });
    const notices = sqlite.raw.prepare("SELECT line_account_id,body,metadata FROM notifications WHERE event_type='cross_tenant_media_removed'").all() as Array<{line_account_id:string;body:string;metadata:string}>;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({line_account_id:'acc-t2'});
    expect(notices[0].body).toContain('1件');
    expect(JSON.parse(notices[0].metadata)).toMatchObject({reasonCode:'CROSS_TENANT_MEDIA_REMOVED',usageCount:1});
    expect(JSON.stringify(notices)).not.toContain('images/t1.png');
  });

  test('統括所有バナーも保存期限で削除し、別統括の使用を記録する', async () => {
    seedTenant('t1',{requested:jst(-1)}); seedTenant('t2',{planStatus:'active'});
    sqlite.raw.exec(`INSERT INTO media(id,kind,filename,mime_type,size_bytes,r2_key,line_account_id)
      VALUES('banner-media','image','banner.png','image/png',10,'images/banner.png',NULL);
      INSERT INTO banner_projects(id,tenant_id,name) VALUES('project','t1','架空');
      INSERT INTO banner_images(id,tenant_id,project_id,media_id) VALUES('banner','t1','project','banner-media');
      INSERT INTO events(id,line_account_id,name,image_url) VALUES('foreign-event','acc-t2','架空','https://example.test/media/banner-media/content');`);
    const IMAGES=createR2();
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    expect(IMAGES.delete).toHaveBeenCalledWith(['images/banner.png']);
    expect(count('media','id=?','banner-media')).toBe(0);
    expect(count('notifications',"event_type=? AND line_account_id=?",'cross_tenant_media_removed','acc-t2')).toBe(1);
    expect(count('media_deletion_jobs','media_id=?','banner-media')).toBe(0);
    expect(count('media_purge_impact_pending','media_id=?','banner-media')).toBe(0);
  });

  test('別統括のバナーは画像なしとして残り、元の画像の削除を記録する', async () => {
    seedTenant('t1',{requested:jst(-1)}); seedTenant('t2',{planStatus:'active'}); seedTenant('t3',{planStatus:'active'});
    seedMedia('t1','images/retired.png');
    sqlite.raw.exec(`INSERT INTO banner_projects(id,tenant_id,name) VALUES('p2','t2','二'),('p3','t3','三');
      INSERT INTO banner_images(id,tenant_id,project_id,media_id) VALUES('b2','t2','p2','media-t1'),('b3','t3','p3','media-t1');
      INSERT INTO banner_image_deliveries(id,banner_image_id,line_account_id,media_id) VALUES('d2','b2','acc-t2','media-t1'),('d3','b2','acc-t3','media-t1');`);
    const IMAGES=createR2();
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    const rows=sqlite.raw.prepare(`SELECT b.tenant_id,b.id,m.id media_id,m.r2_key,m.filename FROM banner_images b JOIN media m ON m.id=b.media_id ORDER BY b.id`).all() as Array<{tenant_id:string;id:string;media_id:string;r2_key:string;filename:string}>;
    expect(rows.map(row=>row.id)).toEqual(['b2','b3']);
    expect(new Set(rows.map(row=>row.media_id)).size).toBe(2);
    expect(rows.every(row=>row.r2_key.startsWith('missing-banner/') && row.filename==='画像がありません')).toBe(true);
    const placeholder=sqlite.raw.prepare('SELECT * FROM media WHERE id=?').get(rows[0].media_id) as Media;
    expect(serializeMedia(placeholder,'https://example.test').url).toBe('');
    expect(count('banner_image_deliveries','id=?','d2')).toBe(1);
    expect(sqlite.raw.prepare(`SELECT d.id,m.line_account_id FROM banner_image_deliveries d JOIN media m ON m.id=d.media_id ORDER BY d.id`).all())
      .toEqual([{id:'d2',line_account_id:'acc-t2'},{id:'d3',line_account_id:'acc-t3'}]);
    expect(count('audit_events',"action=? AND reason=?",'media_removed_cross_tenant','CROSS_TENANT_MEDIA_REMOVED')).toBeGreaterThanOrEqual(2);
    expect(count('media','id=?','media-t1')).toBe(0);
    expect(IMAGES.delete).toHaveBeenCalledWith(['images/retired.png']);
  });

  test('旧版の画像を消せなかったときは記録せず、再試行で1件だけ記録する', async () => {
    seedTenant('t1', { requested:jst(-1) }); seedTenant('t2', { planStatus:'active' });
    seedMedia('t1','images/current.png');
    sqlite.raw.exec(`INSERT INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes)
      VALUES('version1','media-t1',1,'images/old.png','image/png',10);
      INSERT INTO events(id,line_account_id,name,image_url) VALUES('event-old','acc-t2','架空','https://example.test/images/old.png');`);
    const IMAGES=createR2(); IMAGES.delete.mockRejectedValueOnce(new Error('offline'));
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(0);
    expect(count('audit_events',"action = ?",'media_removed_cross_tenant')).toBe(0);
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    expect(count('audit_events',"action = ? AND line_account_id = ?",'media_removed_cross_tenant','acc-t2')).toBe(1);
  });

  test('削除の失敗後に使用先が消えても、削除前に固定した影響を再試行で記録する', async () => {
    seedTenant('t1', { requested:jst(-1) }); seedTenant('t2', { planStatus:'active' });
    seedMedia('t1','images/t1.png');
    sqlite.raw.exec("INSERT INTO events(id,line_account_id,name,image_url) VALUES('event-old','acc-t2','架空','https://example.test/images/t1.png')");
    const IMAGES=createR2();
    IMAGES.delete.mockImplementationOnce(async () => {
      sqlite.raw.prepare("DELETE FROM events WHERE id='event-old'").run();
      throw new Error('offline');
    });
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(0);
    expect(count('audit_events',"action = ?",'media_removed_cross_tenant')).toBe(0);
    expect(count('media_purge_impact_pending',"target_line_account_id = ?",'acc-t2')).toBe(1);
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    expect(count('audit_events',"action = ? AND line_account_id = ?",'media_removed_cross_tenant','acc-t2')).toBe(1);
    expect(count('media_purge_impact_pending','owner_line_account_id = ?','acc-t1')).toBe(0);
  });

  test('登録画像のR2削除に失敗したときはキーと親を残して次回に再試行する', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedMedia('t1', 'images/t1.png');
    const IMAGES = createR2();
    IMAGES.delete.mockRejectedValueOnce(new Error('R2 offline'));
    const first = await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW });
    expect(first.completed).toBe(0);
    expect(count('media', 'id = ?', 'media-t1')).toBe(1);
    expect(count('line_accounts', 'id = ?', 'acc-t1')).toBe(1);
    expect((await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW })).completed).toBe(1);
    expect(count('media', 'id = ?', 'media-t1')).toBe(0);
    expect(IMAGES.delete).toHaveBeenCalledTimes(2);
  });

  test('送信中の画像は保存期限の削除を待ち、送信終了後に再試行する', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedMedia('t1', 'images/t1.png');
    sqlite.raw.prepare('INSERT INTO media_send_claims(claim_id,media_id,line_account_id,expires_at) VALUES(?,?,?,?)')
      .run('send','media-t1','acc-t1',new Date(Date.now()+86_400_000).toISOString());
    const IMAGES = createR2();
    const first = await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW});
    expect(first.completed).toBe(0);
    expect(IMAGES.delete).not.toHaveBeenCalled();
    expect(count('media_send_claims','claim_id=?','send')).toBe(1);
    sqlite.raw.prepare("DELETE FROM media_send_claims WHERE claim_id='send'").run();
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    expect(IMAGES.delete).toHaveBeenCalledWith(['images/t1.png']);
  });

  test('保存期限のR2削除中に新たな送信を開始できない', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedMedia('t1', 'images/t1.png');
    const IMAGES = createR2();
    IMAGES.delete.mockImplementationOnce(async () => {
      await expect(claimMediaForSend(sqlite.db,{claimId:'concurrent-send',accountId:'acc-t1',
        content:'https://example.test/images/t1.png',expiresAt:jst(1)})).rejects.toThrow('media_deletion_in_progress');
    });
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES},{now:NOW})).completed).toBe(1);
    expect(count('media_send_claims','claim_id=?','concurrent-send')).toBe(0);
  });

  test('別統括の共通初期セットの使用を店IDなし・種類と件数と理由だけで記録する', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedTenant('t2', { planStatus: 'active' });
    seedMedia('t1', 'images/t1.png');
    sqlite.raw.prepare(`INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,updated_at)
      VALUES ('set1','t2','standard','架空',?,?)`).run(JSON.stringify({image:'https://example.test/images/t1.png'}), NOW);
    const result = await processTenantDataPurge({ DB: sqlite.db, IMAGES: createR2() }, { now: NOW });
    expect(result.completed).toBe(1);
    const record = sqlite.raw.prepare("SELECT tenant_id,line_account_id,target_kind,reason,after_json FROM audit_events WHERE action='media_removed_cross_tenant' AND tenant_id='t2' AND line_account_id IS NULL").get() as {tenant_id:string;line_account_id:null;target_kind:string;reason:string;after_json:string};
    expect(record).toMatchObject({tenant_id:'t2',line_account_id:null,target_kind:'style_starter_set',reason:'CROSS_TENANT_MEDIA_REMOVED'});
    expect(JSON.parse(record.after_json)).toEqual({usageCount:1});
    expect(JSON.stringify(record)).not.toContain('images/t1.png');
    expect(JSON.stringify(record)).not.toContain('example.test');
  });

  test('未配布の統括テンプレートも店IDなしで影響を記録する', async () => {
    seedTenant('t1',{requested:jst(-1)}); seedTenant('t2',{planStatus:'active'}); seedMedia('t1','images/t1.png');
    sqlite.raw.exec(`INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES('tpl','t2','template','架空');
      INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash)
        VALUES('ver','t2','tpl',1,'{"image":"https://example.test/images/t1.png"}','hash');`);
    expect((await processTenantDataPurge({DB:sqlite.db,IMAGES:createR2()},{now:NOW})).completed).toBe(1);
    const record=sqlite.raw.prepare("SELECT tenant_id,line_account_id,target_kind,reason,after_json FROM audit_events WHERE action='media_removed_cross_tenant' AND target_kind='hq_template_version'").get() as {tenant_id:string;line_account_id:null;target_kind:string;reason:string;after_json:string};
    expect(record).toMatchObject({tenant_id:'t2',line_account_id:null,reason:'CROSS_TENANT_MEDIA_REMOVED'});
    expect(JSON.parse(record.after_json)).toEqual({usageCount:1});
    expect(JSON.stringify(record)).not.toMatch(/images\/t1\.png|example\.test/);
  });

  test('統括と店が決まらない全体共通設定は、種類と件数と理由だけを運営に記録する', async () => {
    seedTenant('t1', { requested: jst(-1) });
    seedMedia('t1', 'images/t1.png');
    sqlite.raw.prepare(`INSERT INTO ec_notification_settings(event_type,created_at,updated_at,image_url)
      VALUES('fake_event',?,?,?)`).run(NOW,NOW,'https://example.test/images/t1.png');
    expect((await processTenantDataPurge({ DB:sqlite.db, IMAGES:createR2() }, { now:NOW })).completed).toBe(1);
    const row = sqlite.raw.prepare("SELECT line_account_id,metadata FROM notifications WHERE event_type='global_media_removed'").get() as {line_account_id:null;metadata:string};
    expect(row.line_account_id).toBeNull();
    expect(JSON.parse(row.metadata)).toEqual({kind:'ec_notification_settings',usageCount:1,reasonCode:'CROSS_TENANT_MEDIA_REMOVED'});
    expect(row.metadata).not.toContain('images/t1.png');
    expect(row.metadata).not.toContain('example.test');
  });

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
    const fingerprint = createHash('sha256').update('images/t1.png').digest('hex');
    const marks = sqlite.raw.prepare('SELECT * FROM media_deleted_key_fingerprints').all();
    expect(marks).toEqual([{sha256:fingerprint}]);
    expect(JSON.stringify(marks)).not.toContain('images/t1.png');
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
   * タグ未設定のフォームも削除対象へ含めるため、利用アカウントから所属を解決する。
   * 別の統括でも共有しているフォームや所属不明のフォームは、他者のデータを消さないよう保持する。
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

  function seedDocument(tenantId: string) {
    seedFriends(tenantId, 1); seedForm(`f-${tenantId}`, null, [`acc-${tenantId}`]);
    sqlite.raw.prepare(`INSERT INTO form_submissions(id,form_id,friend_id,data) VALUES (?, ?, ?, '{}')`).run(`answer-${tenantId}`, `f-${tenantId}`, `u-${tenantId}-0`);
    sqlite.raw.prepare(`INSERT INTO form_submission_files(id,line_account_id,form_id,block_id,friend_id,submission_id,file_kind,side,r2_key,filename,mime_type,size_bytes,scan_id,created_at)
      VALUES (?, ?, ?, 'b', ?, ?, 'pdf', 'single', ?, 'a.pdf', 'application/pdf', 10, 'scan', ?)`)
      .run(`doc-${tenantId}`, `acc-${tenantId}`, `f-${tenantId}`, `u-${tenantId}-0`, `answer-${tenantId}`, `private/form-documents/${tenantId}.pdf`, NOW);
  }
  test.each(['expired', 'requested'])('書類は%sの削除で実体まで消し、別の統括は守る', async reason => {
    seedTenant('t1', reason === 'expired' ? { anchor: jst(-91) } : { requested: jst(-1) }); seedDocument('t1');
    seedTenant('t2', { planStatus: 'active' }); seedDocument('t2');
    const IMAGES = createR2();
    expect((await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW })).completed).toBe(1);
    expect(count('form_submission_files', 'id = ?', 'doc-t1')).toBe(0);
    expect(count('form_submission_files', 'id = ?', 'doc-t2')).toBe(1);
    expect(IMAGES.delete).toHaveBeenCalledWith(['private/form-documents/t1.pdf']);
  });
  test('書類をR2から消せない時は行と親を残し、次回に消し直す', async () => {
    seedTenant('t1', { requested: jst(-1) }); seedDocument('t1');
    const IMAGES = createR2(); IMAGES.delete.mockRejectedValueOnce(new Error('R2 offline'));
    const first = await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW });
    expect(first.completed).toBe(0); expect(first.failedObjects).toBe(1);
    expect(count('form_submission_files', 'id = ?', 'doc-t1')).toBe(1);
    expect(count('form_submissions', 'id = ?', 'answer-t1')).toBe(1);
    expect(count('friends', 'id = ?', 'u-t1-0')).toBe(1);
    expect((await processTenantDataPurge({ DB: sqlite.db, IMAGES }, { now: NOW })).completed).toBe(1);
    expect(count('form_submission_files', 'id = ?', 'doc-t1')).toBe(0);
    expect(IMAGES.delete).toHaveBeenCalledTimes(2);
  });
});
