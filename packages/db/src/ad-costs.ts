import { jstNow } from './utils.js';

/**
 * 流入の広告費の台帳 (#818)。
 *
 * 外部連携(ad_platforms)の暗号化された秘密で媒体から毎日取り込む分と、
 * 管理画面から手入力する分を同じ表に置く。どちらの分かは `source` で
 * 区別し、手入力の分には画面で「手入力」の札を付ける。
 *
 * 金額は最小通貨単位(amount_minor)で保存する。通貨が違う行を
 * 換算なしに足し合わせないため、集計は必ず currency ごとに行う。
 */

export interface AdCostEntry {
  id: string;
  line_account_id: string;
  ad_platform_id: string | null;
  entry_route_id: string | null;
  source_label: string;
  day: string;
  amount_minor: number;
  currency: string;
  source: 'import' | 'manual';
  imported_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdCostImportRun {
  id: string;
  ad_platform_id: string;
  day: string;
  status: 'success' | 'failed';
  error_message: string | null;
  created_at: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isValidCostDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_PATTERN.test(value);
}

export function normalizeCostCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(code) ? code : null;
}

/**
 * 1行分の費用を書く。同じ流入先・同じ日・同じ入り口が来たら上書きする。
 * 取り直しや手直しで行が増えないよう、INSERT OR REPLACE ではなく
 * 既存行の UPDATE に寄せて id を保つ。
 */
export async function upsertAdCostEntry(
  db: D1Database,
  input: {
    lineAccountId: string;
    adPlatformId?: string | null;
    entryRouteId?: string | null;
    sourceLabel: string;
    day: string;
    amountMinor: number;
    currency?: string;
    source: 'import' | 'manual';
    createdBy?: string | null;
  },
): Promise<AdCostEntry> {
  const currency = normalizeCostCurrency(input.currency) ?? 'JPY';
  const now = jstNow();
  const existing = await db
    .prepare(
      `SELECT id FROM ad_cost_entries
        WHERE line_account_id = ?
          AND COALESCE(ad_platform_id, '') = ?
          AND COALESCE(entry_route_id, '') = ?
          AND source_label = ?
          AND day = ?`,
    )
    .bind(
      input.lineAccountId,
      input.adPlatformId ?? '',
      input.entryRouteId ?? '',
      input.sourceLabel,
      input.day,
    )
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE ad_cost_entries
            SET amount_minor = ?, currency = ?, source = ?,
                imported_at = COALESCE(?, imported_at), updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        input.amountMinor,
        currency,
        input.source,
        input.source === 'import' ? now : null,
        now,
        existing.id,
      )
      .run();
    return (await db
      .prepare('SELECT * FROM ad_cost_entries WHERE id = ?')
      .bind(existing.id)
      .first<AdCostEntry>())!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO ad_cost_entries
         (id, line_account_id, ad_platform_id, entry_route_id, source_label,
          day, amount_minor, currency, source, imported_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.adPlatformId ?? null,
      input.entryRouteId ?? null,
      input.sourceLabel,
      input.day,
      input.amountMinor,
      currency,
      input.source,
      input.source === 'import' ? now : null,
      input.createdBy ?? null,
      now,
      now,
    )
    .run();
  return (await db
    .prepare('SELECT * FROM ad_cost_entries WHERE id = ?')
    .bind(id)
    .first<AdCostEntry>())!;
}

/** 取込の成否を日ごとに残す。同じ日に取り直したら最新の結果に差し替える。 */
export async function recordAdCostImportRun(
  db: D1Database,
  input: {
    adPlatformId: string;
    day: string;
    status: 'success' | 'failed';
    errorMessage?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ad_cost_import_runs (id, ad_platform_id, day, status, error_message)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ad_platform_id, day)
       DO UPDATE SET status = excluded.status,
                     error_message = excluded.error_message,
                     created_at = excluded.created_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.adPlatformId,
      input.day,
      input.status,
      input.errorMessage ?? null,
    )
    .run();
}

/** その日の取込が既に成功しているか。cron が何度走っても取り直さないようにする。 */
export async function hasSuccessfulAdCostImport(
  db: D1Database,
  adPlatformId: string,
  day: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM ad_cost_import_runs
        WHERE ad_platform_id = ? AND day = ? AND status = 'success'`,
    )
    .bind(adPlatformId, day)
    .first<{ ok: number }>();
  return !!row;
}

/**
 * 広告の管理画面に出す費用の一覧。
 *
 * 流入元ごとに期間分の費用を合計し、流入元が分かる行には友だち追加数と
 * 「1人あたり = 費用 ÷ 友だち追加」を付ける。通貨が混ざった行は
 * 換算根拠がないため currencies に列挙して画面側で分ける。
 */
export interface AdCostSummaryRow {
  sourceLabel: string;
  adPlatformId: string | null;
  entryRouteId: string | null;
  source: 'import' | 'manual';
  /** 通貨ごとの合計。混在時は合算しない */
  totals: Array<{ currency: string; amountMinor: number }>;
  friendAdds: number | null;
  lastImportedAt: string | null;
}

export async function getAdCostSummary(
  db: D1Database,
  input: { lineAccountId: string; from: string; to: string },
): Promise<AdCostSummaryRow[]> {
  const rows = await db
    .prepare(
      `SELECT
         COALESCE(entry_route_id, '') AS route_key,
         COALESCE(ad_platform_id, '') AS platform_key,
         source_label,
         MAX(source = 'manual') AS has_manual,
         MIN(source = 'import') AS has_import,
         currency,
         SUM(amount_minor) AS amount_minor,
         MAX(imported_at) AS last_imported_at
       FROM ad_cost_entries
       WHERE line_account_id = ?
         AND day >= ? AND day <= ?
       GROUP BY route_key, platform_key, source_label, currency`,
    )
    .bind(input.lineAccountId, input.from, input.to)
    .all<{
      route_key: string;
      platform_key: string;
      source_label: string;
      has_manual: number;
      has_import: number;
      currency: string;
      amount_minor: number;
      last_imported_at: string | null;
    }>();

  const grouped = new Map<string, AdCostSummaryRow>();
  for (const row of rows.results) {
    const key = `${row.route_key}|${row.platform_key}|${row.source_label}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.totals.push({ currency: row.currency, amountMinor: Number(row.amount_minor) });
      if (row.has_manual) existing.source = 'manual';
      if (row.last_imported_at && (!existing.lastImportedAt || row.last_imported_at > existing.lastImportedAt)) {
        existing.lastImportedAt = row.last_imported_at;
      }
      continue;
    }
    grouped.set(key, {
      sourceLabel: row.source_label,
      adPlatformId: row.platform_key || null,
      entryRouteId: row.route_key || null,
      source: row.has_manual ? 'manual' : 'import',
      totals: [{ currency: row.currency, amountMinor: Number(row.amount_minor) }],
      friendAdds: null,
      lastImportedAt: row.last_imported_at,
    });
  }

  // 流入元が結びついた行だけ、その経路の友だち追加数を付ける。
  // friend_add_events は発生日時が JST 文字列なので先頭10文字が日になる。
  const summaries = [...grouped.values()];
  const routeIds = summaries.flatMap((row) => (row.entryRouteId ? [row.entryRouteId] : []));
  if (routeIds.length > 0) {
    const adds = await db
      .prepare(
        `SELECT entry_route_id, COUNT(*) AS adds
           FROM friend_add_events
          WHERE line_account_id = ?
            AND entry_route_id IS NOT NULL
            AND substr(occurred_at, 1, 10) >= ? AND substr(occurred_at, 1, 10) <= ?
          GROUP BY entry_route_id`,
      )
      .bind(input.lineAccountId, input.from, input.to)
      .all<{ entry_route_id: string; adds: number }>();
    const addsByRoute = new Map(adds.results.map((row) => [row.entry_route_id, Number(row.adds)]));
    for (const row of summaries) {
      if (row.entryRouteId) row.friendAdds = addsByRoute.get(row.entryRouteId) ?? 0;
    }
  }
  return summaries.sort((a, b) => {
    const amountOf = (row: AdCostSummaryRow) =>
      row.totals.reduce((sum, total) => sum + total.amountMinor, 0);
    return amountOf(b) - amountOf(a) || a.sourceLabel.localeCompare(b.sourceLabel);
  });
}

/**
 * 分析画面の経路別の費用。流入元が結びついた分だけを通貨別に返す。
 * 通貨が2種類以上ある経路は換算根拠がないので呼び出し側で「出せない」扱いにする。
 */
export async function getAdCostTotalsByRoute(
  db: D1Database,
  input: { lineAccountId: string; from: string; to: string },
): Promise<Map<string, { currency: string; amountMinor: number }[]>> {
  const rows = await db
    .prepare(
      `SELECT entry_route_id, currency, SUM(amount_minor) AS amount_minor
         FROM ad_cost_entries
        WHERE line_account_id = ? AND entry_route_id IS NOT NULL
          AND day >= ? AND day <= ?
        GROUP BY entry_route_id, currency`,
    )
    .bind(input.lineAccountId, input.from, input.to)
    .all<{ entry_route_id: string; currency: string; amount_minor: number }>();
  const map = new Map<string, { currency: string; amountMinor: number }[]>();
  for (const row of rows.results) {
    const list = map.get(row.entry_route_id) ?? [];
    list.push({ currency: row.currency, amountMinor: Number(row.amount_minor) });
    map.set(row.entry_route_id, list);
  }
  return map;
}

/** 媒体ごとの取込状況。最後に取れた日時と、直近の取込の成否を返す。 */
export interface AdCostImportStatus {
  adPlatformId: string;
  /** 取込に成功した中でいちばん新しい時刻。一度も取れていなければ null */
  lastSuccessAt: string | null;
  /** 直近の取込の成否。まだ一度も走っていなければ null */
  lastRunStatus: 'success' | 'failed' | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export async function getAdCostImportStatus(
  db: D1Database,
  adPlatformIds: string[],
): Promise<Map<string, AdCostImportStatus>> {
  const map = new Map<string, AdCostImportStatus>();
  if (adPlatformIds.length === 0) return map;
  const placeholders = adPlatformIds.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT ad_platform_id, status, error_message, created_at
         FROM ad_cost_import_runs
        WHERE ad_platform_id IN (${placeholders})
        ORDER BY created_at DESC`,
    )
    .bind(...adPlatformIds)
    .all<{
      ad_platform_id: string;
      status: 'success' | 'failed';
      error_message: string | null;
      created_at: string;
    }>();
  for (const row of rows.results) {
    const current = map.get(row.ad_platform_id) ?? {
      adPlatformId: row.ad_platform_id,
      lastSuccessAt: null,
      lastRunStatus: null,
      lastRunAt: null,
      lastError: null,
    };
    if (current.lastRunAt === null) {
      current.lastRunStatus = row.status;
      current.lastRunAt = row.created_at;
      current.lastError = row.error_message;
    }
    if (row.status === 'success' && current.lastSuccessAt === null) {
      current.lastSuccessAt = row.created_at;
    }
    map.set(row.ad_platform_id, current);
  }
  return map;
}
