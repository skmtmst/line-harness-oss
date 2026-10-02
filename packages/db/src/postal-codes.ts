/**
 * F11 郵便番号→住所の参照。
 *
 * 日本郵便の公開郵便番号データを `postal_codes` 表へ取り込んで使う。
 * 利用時の外部通信はしない。顧客の郵便番号・住所を外へ送らない。
 * 全量未取り込みの環境では `readiness` で未反映を名乗り、利用可能と偽らない。
 */

export interface PostalCodeCandidate {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface PostalReadiness {
  fullDataset: boolean;
  rowCount: number;
  importedAt: string | null;
  source: string | null;
}

export function normalizePostalQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9]/g, '');
  return /^\d{7}$/.test(digits) ? digits : null;
}

export function formatPostalHyphen(digits7: string): string {
  return `${digits7.slice(0, 3)}-${digits7.slice(3)}`;
}

export async function getPostalReadiness(db: D1Database): Promise<PostalReadiness> {
  try {
    const row = await db.prepare(
      'SELECT COUNT(*) AS n, MAX(imported_at) AS imported_at, MAX(source_name) AS source_name FROM postal_codes',
    ).first<{ n: number; imported_at: string | null; source_name: string | null }>();
    const count = Number(row?.n ?? 0);
    return {
      fullDataset: count > 0,
      rowCount: count,
      importedAt: row?.imported_at ?? null,
      source: row?.source_name ?? null,
    };
  } catch {
    return { fullDataset: false, rowCount: 0, importedAt: null, source: null };
  }
}

export async function searchPostalCodes(
  db: D1Database,
  digits7: string,
  fallback: PostalCodeCandidate[],
): Promise<{ candidates: PostalCodeCandidate[]; fromDb: boolean }> {
  try {
    const result = await db.prepare(
      `SELECT postal_code AS postalCode, prefecture, city, town
         FROM postal_codes WHERE postal_code = ? ORDER BY prefecture, city, town LIMIT 20`,
    ).bind(digits7).all<PostalCodeCandidate>();
    const rows = result.results ?? [];
    if (rows.length > 0) return { candidates: rows, fromDb: true };
  } catch {
    // 表が無い環境（migration未反映）は下のfixtureへ倒す。
  }
  const hyphen = formatPostalHyphen(digits7);
  const hits = fallback.filter((row) => row.postalCode === digits7 || row.postalCode === hyphen);
  return { candidates: hits, fromDb: false };
}
