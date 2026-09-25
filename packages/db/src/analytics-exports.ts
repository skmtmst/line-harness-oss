import { jstNow } from './utils.js';
import type { AnalyticsMetric } from './analytics-overviews.js';
import type { AnalyticsCrossResult } from './analytics-cross.js';
import type { FunnelGroupEvaluation, FunnelRunResult } from './analytics-funnels.js';
import type { SavedAnalyticsSummary } from './analytics-saved.js';

/**
 * v6-20 分析の非同期CSV書き出し（要件 §8 `POST /api/analytics/exports`）の台帳と、
 * 画面内のCSVと同じ中身を組み立てる builder。
 *
 * 列の並び・見出し・空欄の扱いは `apps/web/src/app/analytics/page.tsx` の
 * 各 export 関数と1対1に対応する。画面側を変えたらこちらも変える。
 * 日付や母数の数え直しはしない。画面が読むのと同じ集計関数を読む。
 */

export type AnalyticsExportTarget = 'reactions' | 'url-clicks' | 'cross' | 'funnel' | 'saved';

export type AnalyticsExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export interface AnalyticsExportParams {
  from?: string;
  to?: string;
  query?: string;
  resultId?: string;
  funnelId?: string;
  groupKey?: string;
}

export interface AnalyticsExportJob {
  id: string;
  line_account_id: string;
  target: AnalyticsExportTarget;
  params_json: string;
  status: AnalyticsExportStatus;
  row_count: number | null;
  byte_size: number | null;
  csv_text: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
  failure_reason: string | null;
}

/** detail 用の読み取り列。csv_text はダウンロード経路だけが読む。 */
const EXPORT_JOB_META_COLUMNS = `id, line_account_id, target, params_json, status,
  row_count, byte_size, created_by, created_by_name,
  created_at, started_at, finished_at, expires_at, failure_reason`;

export type AnalyticsExportJobMeta = Omit<AnalyticsExportJob, 'csv_text'>;

/** ダウンロードの有効期間。common_var_export_jobs と同じ 7 日。 */
export const ANALYTICS_EXPORT_TTL_MS = 7 * 86_400_000;

/** 成果物の上限。common_var_export と同じ 4MiB。超えたら失敗にして絞り込みへ誘導する。 */
export const ANALYTICS_EXPORT_MAX_BYTES = 4 * 1024 * 1024;

const ANALYTICS_EXPORT_TARGETS: AnalyticsExportTarget[] = [
  'reactions', 'url-clicks', 'cross', 'funnel', 'saved',
];

export function parseAnalyticsExportTarget(value: unknown): AnalyticsExportTarget | null {
  return typeof value === 'string'
    && (ANALYTICS_EXPORT_TARGETS as string[]).includes(value)
    ? value as AnalyticsExportTarget
    : null;
}

export function parseAnalyticsExportParams(value: unknown): AnalyticsExportParams {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof raw[key] === 'string' && raw[key].trim() ? (raw[key] as string).trim() : undefined;
  const params: AnalyticsExportParams = {};
  const from = text('from');
  const to = text('to');
  const query = text('query');
  const resultId = text('resultId');
  const funnelId = text('funnelId');
  const groupKey = text('groupKey');
  if (from) params.from = from;
  if (to) params.to = to;
  if (query) params.query = query;
  if (resultId) params.resultId = resultId;
  if (funnelId) params.funnelId = funnelId;
  if (groupKey) params.groupKey = groupKey;
  return params;
}

/**
 * `apps/web/src/lib/presentation.ts` の csvCell と同じ整形。
 * null・undefined は空欄（画面の shownValue が null を返す項目と同じ）。
 * 先頭が `=+-@` の値は計算式として開かせない。
 */
export function analyticsCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export type AnalyticsCsvRow = Array<string | number | null | undefined>;

export function analyticsCsvText(rows: AnalyticsCsvRow[]): string {
  return `${rows.map((row) => row.map(analyticsCsvCell).join(',')).join('\r\n')}\r\n`;
}

function shownCell(metric: AnalyticsMetric<number>): number | null {
  if (metric.value === null) return null;
  return metric.state === 'available' || metric.state === 'partial' ? metric.value : null;
}

export interface ReactionCampaignCsv {
  name: string;
  kind: 'broadcast' | 'scenario';
  sentAt: string;
  targetPeople: AnalyticsMetric<number>;
  delivered: AnalyticsMetric<number>;
  opened: AnalyticsMetric<number>;
  lineClicked: AnalyticsMetric<number>;
  outcomes: AnalyticsMetric<number>;
}

export interface ReactionsOverviewCsv {
  campaigns: ReactionCampaignCsv[];
  campaignsTruncation: { limit: number; broadcast: boolean; scenario: boolean };
}

/** 画面の exportCampaigns と同じ中身。打切りの断り行も同じ文面で残す。 */
export function buildReactionsCsv(overview: ReactionsOverviewCsv): AnalyticsCsvRow[] {
  const broadcastShown = overview.campaigns.filter((item) => item.kind === 'broadcast').length;
  const scenarioShown = overview.campaigns.length - broadcastShown;
  const truncationNote = [
    overview.campaignsTruncation.broadcast ? `一斉配信は新しい方から先頭${broadcastShown}件` : null,
    overview.campaignsTruncation.scenario ? `シナリオは新しい方から先頭${scenarioShown}件` : null,
  ].filter(Boolean).join('・');
  return [
    ['配信', '種類', '送った日時', '対象', '到達', '開封', 'LINEクリック', '成果'],
    ...overview.campaigns.map((item) => [
      item.name,
      item.kind === 'broadcast' ? '一斉配信' : 'シナリオ',
      item.sentAt,
      shownCell(item.targetPeople),
      shownCell(item.delivered),
      shownCell(item.opened),
      shownCell(item.lineClicked),
      shownCell(item.outcomes),
    ] as AnalyticsCsvRow),
    ...(truncationNote ? [[`※${truncationNote}までを表示（それより古い配信は含みません）`]] : []),
  ];
}

export interface UrlClickCsv {
  name: string;
  originalUrl: string;
  clicks: AnalyticsMetric<number>;
  knownClickPeople: AnalyticsMetric<number>;
  usageLocations: string[];
}

/** 画面の exportRows（URLクリック）と中身。探す言葉の絞り込みも同じ。 */
export function buildUrlClicksCsv(
  links: UrlClickCsv[],
  query?: string,
): AnalyticsCsvRow[] {
  const needle = (query ?? '').trim().toLowerCase();
  const visible = needle
    ? links.filter((item) =>
      `${item.name} ${item.originalUrl} ${item.usageLocations.join(' ')}`.toLowerCase().includes(needle))
    : links;
  return [
    ['リンク名', 'URL', '押された回数', '押した人', '使われた場所'],
    ...visible.map((item) => [
      item.name,
      item.originalUrl,
      shownCell(item.clicks),
      shownCell(item.knownClickPeople),
      item.usageLocations.join('、'),
    ] as AnalyticsCsvRow),
  ];
}

const SAVED_STATE_LABELS: Record<string, string> = {
  available: '利用可能',
  partial: '一部集計',
  unavailable: '未取得',
  failed: '失敗',
};

/** 画面の exportSaved と同じ中身。探す言葉の絞り込みも同じ。 */
export function buildSavedCsv(
  items: SavedAnalyticsSummary[],
  query?: string,
): AnalyticsCsvRow[] {
  const needle = (query ?? '').trim().toLowerCase();
  const visible = needle
    ? items.filter((item) =>
      `${item.name} ${item.createdByName}`.toLowerCase().includes(needle))
    : items;
  return [
    ['分析名', '種類', '作った人', '定義版', '更新日時', '集計状態', '保存結果数'],
    ...visible.map((item) => [
      item.name,
      item.kind === 'cross' ? 'クロス分析' : 'ファネル',
      item.createdByName,
      item.currentVersionNumber,
      item.updatedAt,
      item.latestSnapshot
        ? `${SAVED_STATE_LABELS[item.latestSnapshot.state] ?? item.latestSnapshot.state}${item.latestSnapshot.definitionStale ? '（旧版の結果・更新後未集計）' : ''}`
        : null,
      item.snapshotCount,
    ] as AnalyticsCsvRow),
  ];
}

/** 画面の exportFunnel と同じ中身。選んだ群・数えられる/いないの扱いも同じ。 */
export function buildFunnelCsv(
  run: FunnelRunResult,
  groupKey?: string,
): AnalyticsCsvRow[] {
  const group: FunnelGroupEvaluation | null =
    run.groups.find((item) => item.key === groupKey) ?? run.groups[0] ?? null;
  const result = group?.steps ?? null;
  if (!result) throw new Error('analytics_export_funnel_empty');
  const measurable = run.state === 'available' || run.state === 'partial';
  return [
    ...(run.state !== 'available'
      ? [['集計状態', `${SAVED_STATE_LABELS[run.state] ?? run.state}${run.stateReason ? `（${run.stateReason}）` : ''}`]]
      : []),
    ...(run.versionNumber != null ? [['集計した定義版', `${run.versionNumber}`]] : []),
    ['段', '到達した人', '前の段からの通過率', 'ここで止まった人', 'まだ途中の人'],
    ...result.map((step) => measurable ? [
      step.label,
      step.reached,
      step.conversionFromPrevious === null ? null : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`,
      step.droppedAfter,
      step.inProgressAfter,
    ] : [step.label, null, null, null, null]),
  ];
}

export const CROSS_ROW_LABELS: Record<string, string> = {
  tag: 'タグ',
  route: '流入経路',
  score_band: 'スコア帯',
  conversion_point: '成果地点',
  booking_status: '予約状態',
  purchase_status: '購入状態',
};

/** 画面の exportCross と同じ中身。行列の合計の数え方も同じ（延べ人数）。 */
export function buildCrossCsv(
  result: AnalyticsCrossResult,
  rowAxisKind: string,
  fieldName: string,
): AnalyticsCsvRow[] {
  const rows = result.rowValues;
  const cols = result.columnValues;
  const lookup = new Map<string, number>();
  for (const cell of result.cells) lookup.set(`${cell.rowKey}\u0000${cell.columnKey}`, cell.value);
  const rowLabel = CROSS_ROW_LABELS[rowAxisKind] ?? rowAxisKind;
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const cell of result.cells) {
    rowTotals.set(cell.rowKey, (rowTotals.get(cell.rowKey) ?? 0) + cell.value);
    colTotals.set(cell.columnKey, (colTotals.get(cell.columnKey) ?? 0) + cell.value);
  }
  const grandTotal = result.cells.reduce((sum, cell) => sum + cell.value, 0);
  return [
    [`${rowLabel} ＼ ${fieldName}`, ...cols.map((column) => column.label), '合計'],
    ...rows.map((row) => [
      row.label,
      ...cols.map((column) => lookup.get(`${row.key}\u0000${column.key}`) ?? 0),
      rowTotals.get(row.key) ?? 0,
    ] as AnalyticsCsvRow),
    ['合計', ...cols.map((column) => colTotals.get(column.key) ?? 0), grandTotal],
  ];
}

export async function createAnalyticsExportJob(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    target: AnalyticsExportTarget;
    params: AnalyticsExportParams;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    expiresAt: string;
  },
): Promise<AnalyticsExportJobMeta> {
  await db.prepare(`
    INSERT INTO analytics_export_jobs
      (id, line_account_id, target, params_json, status,
       created_by, created_by_name, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
  `).bind(
    input.id, input.lineAccountId, input.target, JSON.stringify(input.params),
    input.createdBy, input.createdByName, input.createdAt, input.expiresAt,
  ).run();
  const job = await getAnalyticsExportJob(db, input.id, input.lineAccountId);
  if (!job) throw new Error('analytics export job was not recorded');
  return job;
}

export async function getAnalyticsExportJob(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<AnalyticsExportJobMeta | null> {
  return db.prepare(`
    SELECT ${EXPORT_JOB_META_COLUMNS} FROM analytics_export_jobs
     WHERE id = ? AND line_account_id = ?
  `).bind(id, lineAccountId).first<AnalyticsExportJobMeta>();
}

export async function getAnalyticsExportCsv(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<{ status: AnalyticsExportStatus; csv_text: string | null; expires_at: string } | null> {
  return db.prepare(`
    SELECT status, csv_text, expires_at FROM analytics_export_jobs
     WHERE id = ? AND line_account_id = ?
  `).bind(id, lineAccountId).first<{
    status: AnalyticsExportStatus; csv_text: string | null; expires_at: string;
  }>();
}

export async function markAnalyticsExportRunning(
  db: D1Database,
  id: string,
  startedAt: string,
): Promise<void> {
  await db.prepare(`
    UPDATE analytics_export_jobs SET status = 'running', started_at = ?
     WHERE id = ? AND status = 'queued'
  `).bind(startedAt, id).run();
}

export async function completeAnalyticsExport(
  db: D1Database,
  id: string,
  input: { rowCount: number; csvText: string; byteSize: number; finishedAt: string },
): Promise<void> {
  await db.prepare(`
    UPDATE analytics_export_jobs
       SET status = 'completed', row_count = ?, csv_text = ?, byte_size = ?,
           finished_at = ?
     WHERE id = ?
  `).bind(input.rowCount, input.csvText, input.byteSize, input.finishedAt, id).run();
}

export async function failAnalyticsExport(
  db: D1Database,
  id: string,
  reason: string,
  finishedAt: string,
): Promise<void> {
  await db.prepare(`
    UPDATE analytics_export_jobs
       SET status = 'failed', failure_reason = ?, finished_at = ?
     WHERE id = ?
  `).bind(reason, finishedAt, id).run();
}

export async function markAnalyticsExportExpired(db: D1Database, id: string): Promise<void> {
  await db.prepare(`
    UPDATE analytics_export_jobs SET status = 'expired'
     WHERE id = ? AND status = 'completed'
  `).bind(id).run();
}
