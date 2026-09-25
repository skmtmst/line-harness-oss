import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

const { analyticsExports, runAnalyticsExportJob } = await import('./analytics-exports');
const { analyticsCsvText, buildUrlClicksCsv } = await import('@line-crm/db');

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const staff: AuthenticatedStaff = {
  ...owner, id: 'staff-1', name: '担当者', role: 'staff',
};

function app(db: D1Database, actor: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  instance.route('/', analyticsExports);
  return instance;
}

function json(method: string, body: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('分析CSVの非同期書き出し', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id, timezone)
      VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1', 'Asia/Tokyo')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id, timezone)
      VALUES ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2', 'Asia/Tokyo')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO broadcasts
        (id, title, message_type, message_content, status, sent_at,
         total_count, success_count, line_account_id)
      VALUES ('bc-1', '秋のセール', 'text', 'hello', 'sent',
              '2026-09-10T10:00:00+09:00', 100, 50, 'account-1')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO analytics_saved_analyses
        (id, line_account_id, name, kind, current_version_number, status,
         created_by, created_by_name, created_at, updated_at)
      VALUES ('saved-1', 'account-1', '購入ファネル', 'funnel', 2, 'active',
              'owner-1', 'オーナー', '2026-09-10T10:00:00+09:00', '2026-09-11T10:00:00+09:00')
    `).run();
    testDb.raw.prepare(`INSERT INTO funnels (id, name, line_account_id) VALUES ('funnel-1', '購入', 'account-1')`).run();
    testDb.raw.prepare(`
      INSERT INTO analytics_funnel_runs
        (id, line_account_id, funnel_id, cohort_from, cohort_to, time_zone,
         data_cutoff_at, state, result_json, created_at)
      VALUES ('frun-1', 'account-1', 'funnel-1', '2026-08-01', '2026-08-31', 'Asia/Tokyo',
              '2026-09-01T00:00:00+09:00', 'partial', ?, '2026-09-01T00:00:00+09:00')
    `).run(JSON.stringify({
      funnelId: 'funnel-1', versionId: null, versionNumber: 2, lineAccountId: 'account-1',
      cohortFrom: '2026-08-01', cohortTo: '2026-08-31', timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-09-01T00:00:00+09:00', state: 'partial', stateReason: '一部だけ取得',
      groups: [{
        key: 'all', label: 'すべて', entrants: 10, completed: 3,
        steps: [
          {
            stepOrder: 0, label: '来店', reached: 10, conversionFromPrevious: null,
            droppedAfter: 4, inProgressAfter: 1, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null,
          },
          {
            stepOrder: 1, label: '購入', reached: 5, conversionFromPrevious: 0.5,
            droppedAfter: 5, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null,
          },
        ],
      }],
    }));
    testDb.raw.prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('field-1', '好きな味', 'taste', 'select')`).run();
    testDb.raw.prepare(`
      INSERT INTO analytics_cross_runs
        (id, line_account_id, query_json, state, result_json, error_code,
         period_from, period_to, time_zone, data_cutoff_at, created_at)
      VALUES ('xrun-1', 'account-1', ?, 'available', ?, NULL,
              '2026-08-01', '2026-08-31', 'Asia/Tokyo',
              '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')
    `).run(
      JSON.stringify({
        rowAxis: { kind: 'tag' }, columnAxis: { kind: 'field_choice', fieldId: 'field-1' },
        measure: { kind: 'friends' }, filters: [],
        periodFrom: '2026-08-01', periodTo: '2026-08-31', timeZone: 'Asia/Tokyo',
      }),
      JSON.stringify({
        lineAccountId: 'account-1', timeZone: 'Asia/Tokyo',
        rowValues: [{ key: 'new', label: '新規' }],
        columnValues: [{ key: 'chicken', label: 'チキン' }],
        cells: [{
          rowKey: 'new', rowLabel: '新規', columnKey: 'chicken', columnLabel: 'チキン',
          value: 7, uniqueFriends: 7, totalRatio: null, previousValue: 0,
        }],
        totalValue: 7, totalFriends: 7, previousTotalValue: 0,
        periodFrom: '2026-08-01', periodTo: '2026-08-31',
        previousPeriodFrom: '2026-07-01', previousPeriodTo: '2026-07-31',
        dataCutoffAt: '2026-09-01T00:00:00+09:00', state: 'available', stateReason: null,
      }),
    );
  });

  afterEach(() => {});

  async function exportAndDownload(target: string, params: Record<string, unknown>) {
    const created = await app(testDb.db).request(
      '/api/analytics/exports',
      json('POST', { accountId: 'account-1', target, params }),
    );
    expect(created.status).toBe(202);
    const createdBody = await created.json() as { data: { id: string; status: string } };
    const jobId = createdBody.data.id;
    await runAnalyticsExportJob(testDb.db, jobId);
    const status = await app(testDb.db).request(`/api/analytics/exports/${jobId}?accountId=account-1`);
    expect(status.status).toBe(200);
    const statusBody = await status.json() as { data: { status: string } };
    expect(statusBody.data.status).toBe('completed');
    const download = await app(testDb.db).request(`/api/analytics/exports/${jobId}/download?accountId=account-1`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('text/csv');
    return download.text();
  }

  it('配信の反応を画面と同じ列で書き出す', async () => {
    const csv = await exportAndDownload('reactions', { from: '2026-09-01', to: '2026-09-30' });
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"配信","種類","送った日時","対象","到達","開封","LINEクリック","成果"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"秋のセール","一斉配信","2026-09-10T10:00:00+09:00","100"');
  });

  it('ファネルを状態・定義版・段の順で書き出す', async () => {
    const csv = await exportAndDownload('funnel', { funnelId: 'funnel-1' });
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"集計状態","一部集計（一部だけ取得）"');
    expect(lines[1]).toBe('"集計した定義版","2"');
    expect(lines[2]).toBe('"段","到達した人","前の段からの通過率","ここで止まった人","まだ途中の人"');
    expect(lines[3]).toBe('"来店","10","","4","1"');
    expect(lines[4]).toBe('"購入","5","50%","5","0"');
  });

  it('クロス集計を行列と合計付きで書き出す', async () => {
    const csv = await exportAndDownload('cross', { resultId: 'xrun-1' });
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"タグ ＼ 好きな味","チキン","合計"');
    expect(lines[1]).toBe('"新規","7","7"');
    expect(lines[2]).toBe('"合計","7","7"');
  });

  it('保存した分析を画面と同じ列で書き出す', async () => {
    const csv = await exportAndDownload('saved', {});
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"分析名","種類","作った人","定義版","更新日時","集計状態","保存結果数"');
    expect(lines[1]).toContain('"購入ファネル","ファネル","オーナー","2"');
  });

  it('URLクリックを探す言葉の範囲で書き出す', async () => {
    const links = [
      {
        name: '春の案内', originalUrl: 'https://example.com/spring',
        clicks: { value: 12, state: 'available', reason: null },
        knownClickPeople: { value: 9, state: 'available', reason: null },
        usageLocations: ['一斉配信', 'シナリオ'],
      },
      {
        name: '秋の案内', originalUrl: 'https://example.com/autumn',
        clicks: { value: null, state: 'unavailable', reason: '未取得' },
        knownClickPeople: { value: null, state: 'unavailable', reason: '未取得' },
        usageLocations: [],
      },
    ] as Parameters<typeof buildUrlClicksCsv>[0];
    const csv = analyticsCsvText(buildUrlClicksCsv(links, '春'));
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"リンク名","URL","押された回数","押した人","使われた場所"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"春の案内","https://example.com/spring","12","9","一斉配信、シナリオ"');
    const all = analyticsCsvText(buildUrlClicksCsv(links));
    expect(all.replace(/^﻿/, '').split('\r\n').filter(Boolean)).toHaveLength(3);
  });

  it('権限・対象・他アカウントを断る', async () => {
    const staffDenied = await app(testDb.db, staff).request(
      '/api/analytics/exports',
      json('POST', { accountId: 'account-1', target: 'reactions', params: {} }),
    );
    expect(staffDenied.status).toBe(403);
    const badTarget = await app(testDb.db).request(
      '/api/analytics/exports',
      json('POST', { accountId: 'account-1', target: 'unknown', params: {} }),
    );
    expect(badTarget.status).toBe(400);
    const hidden = await app(testDb.db).request(
      '/api/analytics/exports',
      json('POST', { accountId: 'account-2', target: 'reactions', params: {} }),
    );
    expect(hidden.status).toBe(404);
    const missingResult = await app(testDb.db).request(
      '/api/analytics/exports',
      json('POST', { accountId: 'account-1', target: 'cross', params: {} }),
    );
    expect(missingResult.status).toBe(422);
  });
});
