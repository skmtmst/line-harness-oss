import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const accountAccess = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn() }));
vi.mock('../services/account-access.js', () => accountAccess);

import { commonVarExports, runCommonVarExportJob } from './common-var-exports.js';
import { contents } from './contents.js';

const fixture = vi.hoisted(() => ({
  staff: { id: 'owner-1', name: 'Owner', role: 'owner' as string, readOnly: false },
}));

function app(db: D1Database) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', fixture.staff as never);
    await next();
  });
  // 本番と同じ順序。exports が先に来ないと GET /api/common-vars/exports が
  // contents の /api/common-vars/:id に取られて届かない。
  hono.route('/', commonVarExports);
  hono.route('/', contents);
  return hono;
}

function json(method: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function seedVar(store: SqliteD1, id: string, over: Record<string, unknown> = {}) {
  store.raw.prepare(`INSERT INTO common_vars
    (id, name, var_key, type, value, line_account_id, updated_at)
    VALUES (?, ?, ?, 'text', ?, 'account-a', '2026-09-01T00:00:00.000Z')`)
    .run(id, over.name ?? `項目${id}`, over.varKey ?? `key_${id}`, over.value ?? `値${id}`);
}

type JobJson = {
  id: string; status: string; rowCount: number | null; totalCount: number | null;
  processedCount: number; expiresAt: string; downloadUrl: string | null;
  failureReason: string | null; createdBy: string;
};

describe('共通情報CSVの監査付き非同期出力', () => {
  let store: SqliteD1;

  beforeEach(() => {
    store = createTestD1();
    fixture.staff = { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false };
    store.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a', 'channel-a', 'A', 'token', 'secret'),
              ('account-b', 'channel-b', 'B', 'token', 'secret')`,
    ).run();
    accountAccess.canAccessAllLineAccounts.mockImplementation(async (_db, _staff, ids: string[]) =>
      ids.every((id) => id === 'account-a'));
  });

  it('依頼→生成→ダウンロードまで台帳へ残り、contentsの:idに取られない', async () => {
    seedVar(store, 'v1', { name: '会社名', varKey: 'company', value: '株式会社NEN' });
    seedVar(store, 'v2', { name: '営業時間', varKey: 'hours', value: '10:00-19:00' });

    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    expect(created.status).toBe(201);
    const job = (await created.json() as { data: JobJson }).data;
    expect(job.status).toBe('completed');
    expect(job.rowCount).toBe(2);
    expect(job.totalCount).toBe(2);
    expect(job.processedCount).toBe(2);
    expect(job.createdBy).toBe('owner-1');
    expect(job.downloadUrl).toBe(`/api/common-vars/exports/${job.id}/download`);
    // 台帳へ開始・終了・期限が残る
    const row = store.raw.prepare(
      'SELECT status, started_at, finished_at, expires_at, filter_json FROM common_var_export_jobs WHERE id = ?',
    ).get(job.id) as Record<string, string>;
    expect(row.status).toBe('completed');
    expect(row.started_at).toBeTruthy();
    expect(row.finished_at).toBeTruthy();
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.parse(row.filter_json)).toEqual({ accountId: 'account-a' });

    // GET /api/common-vars/exports は contents の /api/common-vars/:id ではなく一覧に届く
    const list = await app(store.db).request('/api/common-vars/exports?accountId=account-a', {}, { DB: store.db } as Env['Bindings']);
    expect(list.status).toBe(200);
    const jobs = (await list.json() as { data: JobJson[] }).data;
    expect(jobs.map((j) => j.id)).toContain(job.id);

    const status = await app(store.db).request(`/api/common-vars/exports/${job.id}`, {}, { DB: store.db } as Env['Bindings']);
    expect((await status.json() as { data: JobJson }).data.status).toBe('completed');

    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await download.arrayBuffer());
    // UTF-8 BOM(EF BB BF)が先頭に付く。text() だとデコード時に消えるため byte で見る。
    expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('共通情報,差し込みキー,中身,使われている場所,更新,次の変更日時,次の中身');
    expect(csv).toContain('会社名');
    expect(csv).toContain('{会社名}');
    expect(csv).toContain('株式会社NEN');
  });

  it('200件を超える対象もページングで全件書き出す', async () => {
    for (let i = 0; i < 205; i += 1) {
      seedVar(store, `v${String(i).padStart(3, '0')}`, { name: `項目${String(i).padStart(3, '0')}` });
    }
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;
    expect(job.status).toBe('completed');
    expect(job.rowCount).toBe(205);

    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    const lines = (await download.text()).trim().split('\r\n');
    expect(lines).toHaveLength(206); // 見出し1 + 205行
    expect(lines.some((line) => line.includes('項目204'))).toBe(true);
  });

  it('0件でも見出しだけのCSVをcompletedで返す', async () => {
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;
    expect(job.status).toBe('completed');
    expect(job.rowCount).toBe(0);
    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    const text = await download.text();
    expect(text.trim().split('\r\n')).toHaveLength(1);
  });

  it('式注入文字・改行・長い値を安全に1セルへ保つ', async () => {
    seedVar(store, 'v1', { name: '=SUM(1)', value: '+cmd|"/C calc' });
    seedVar(store, 'v2', { name: '長文', value: `改行あり\n次の行と、${'あ'.repeat(600)}` });
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;
    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    const csv = await download.text();
    // = + - @ 始まりは ' を前置して無害化
    expect(csv).toContain("'=SUM(1)");
    expect(csv).toContain("'+cmd|\"\"");
    expect(csv).not.toMatch(/,=[^']/);
    // 改行を含む値はクォート内に留まり、行数が増えない
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('あ'.repeat(600));
  });

  it('別accountの台帳・job・ダウンロードは取得0件（404）', async () => {
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;

    const createDenied = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-b',
    }), { DB: store.db } as Env['Bindings']);
    expect(createDenied.status).toBe(404);
    expect(store.raw.prepare('SELECT COUNT(*) AS c FROM common_var_export_jobs WHERE line_account_id = ?')
      .get('account-b') as { c: number }).toEqual({ c: 0 });

    const listDenied = await app(store.db).request('/api/common-vars/exports?accountId=account-b', {}, { DB: store.db } as Env['Bindings']);
    expect(listDenied.status).toBe(404);

    accountAccess.canAccessAllLineAccounts.mockImplementation(async (_db, _staff, ids: string[]) =>
      ids.every((id) => id === 'account-b'));
    const detailDenied = await app(store.db).request(`/api/common-vars/exports/${job.id}`, {}, { DB: store.db } as Env['Bindings']);
    expect(detailDenied.status).toBe(404);
    const downloadDenied = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    expect(downloadDenied.status).toBe(404);
  });

  it('staff役割は作成・再生成・ダウンロードを実行できない', async () => {
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;

    fixture.staff = { id: 'staff-1', name: 'Staff', role: 'staff', readOnly: false };
    const createDenied = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    expect(createDenied.status).toBe(403);
    const regenDenied = await app(store.db).request(`/api/common-vars/exports/${job.id}/regenerate`, json('POST', {}), { DB: store.db } as Env['Bindings']);
    expect(regenDenied.status).toBe(403);
    const downloadDenied = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    expect(downloadDenied.status).toBe(403);
    // 閲覧は許す
    const listOk = await app(store.db).request('/api/common-vars/exports?accountId=account-a', {}, { DB: store.db } as Env['Bindings']);
    expect(listOk.status).toBe(200);
  });

  it('期限切れは410を返し台帳をexpiredへ確定、再生成で新しい期限が付く', async () => {
    seedVar(store, 'v1');
    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson }).data;
    store.raw.prepare('UPDATE common_var_export_jobs SET expires_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', job.id);

    const detail = await app(store.db).request(`/api/common-vars/exports/${job.id}`, {}, { DB: store.db } as Env['Bindings']);
    expect((await detail.json() as { data: JobJson }).data.status).toBe('expired');
    expect((store.raw.prepare('SELECT status FROM common_var_export_jobs WHERE id = ?').get(job.id) as { status: string }).status).toBe('expired');

    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    expect(download.status).toBe(410);

    const regen = await app(store.db).request(`/api/common-vars/exports/${job.id}/regenerate`, json('POST', {}), { DB: store.db } as Env['Bindings']);
    expect(regen.status).toBe(201);
    const next = (await regen.json() as { data: JobJson }).data;
    expect(next.id).not.toBe(job.id);
    expect(next.status).toBe('completed');
    expect(next.rowCount).toBe(1);
    expect(new Date(next.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('queued のままの job を runCommonVarExportJob が直接完了させる（失敗時はfailed）', async () => {
    seedVar(store, 'v1');
    // 直接 INSERT で queued job を用意して runner を呼ぶ
    store.raw.prepare(`INSERT INTO common_var_export_jobs
      (id, line_account_id, filter_json, status, created_by, created_by_name, created_at, expires_at)
      VALUES ('job-direct', 'account-a', '{"accountId":"account-a"}', 'queued', 'owner-1', 'Owner',
              '2026-09-20T00:00:00.000Z', '2999-01-01T00:00:00.000Z')`).run();
    await runCommonVarExportJob(store.db, 'job-direct');
    const row = store.raw.prepare(
      'SELECT status, row_count, processed_count, csv_text FROM common_var_export_jobs WHERE id = ?',
    ).get('job-direct') as Record<string, unknown>;
    expect(row.status).toBe('completed');
    expect(row.row_count).toBe(1);
    expect(row.processed_count).toBe(1);
    expect(String(row.csv_text)).toContain('項目v1');
  });

  it('フォルダ条件は台帳のfilterへ残り、存在しないfolderIdは400', async () => {
    store.raw.prepare(`INSERT INTO folders (id, kind, account_id, name, display_order, created_at, updated_at)
      VALUES ('folder-1', 'common_var', 'account-a', '営業', 1, '2026-09-01', '2026-09-01')`).run();
    seedVar(store, 'in-folder', { name: '中の項目' });
    store.raw.prepare('UPDATE common_vars SET folder_id = ? WHERE id = ?').run('folder-1', 'in-folder');
    seedVar(store, 'outside', { name: '外の項目' });

    const bad = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a', folderId: 'missing-folder',
    }), { DB: store.db } as Env['Bindings']);
    expect(bad.status).toBe(400);

    const created = await app(store.db).request('/api/common-vars/exports', json('POST', {
      accountId: 'account-a', folderId: 'folder-1',
    }), { DB: store.db } as Env['Bindings']);
    const job = (await created.json() as { data: JobJson & { folderId: string | null } }).data;
    expect(job.status).toBe('completed');
    expect(job.rowCount).toBe(1);
    expect(job.folderId).toBe('folder-1');
    const download = await app(store.db).request(`/api/common-vars/exports/${job.id}/download`, {}, { DB: store.db } as Env['Bindings']);
    const csv = await download.text();
    expect(csv).toContain('中の項目');
    expect(csv).not.toContain('外の項目');
  });
});
