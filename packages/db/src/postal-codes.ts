/**
 * F11 郵便番号→住所の参照。
 *
 * 日本郵便の公開郵便番号データを `postal_codes` 表へ取り込んで使う。
 * 利用時の外部通信はしない。顧客の郵便番号・住所を外へ送らない。
 * 全量未取り込みの環境では `readiness` で未反映を名乗り、利用可能と偽らない。
 */

import { normalizePostalCodeDigits } from '@line-crm/shared';

export interface PostalCodeCandidate {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface PostalReadiness {
  /** 全国版として使える完成品か。部分・試し取り込みではfalse。 */
  fullDataset: boolean;
  rowCount: number;
  importedAt: string | null;
  source: string | null;
  expectedRows: number | null;
  inputSha256: string | null;
  /** 取り込み表の件数が完了記録と一致するか。 */
  complete: boolean;
  /** 公式配布以外の由来（見本・fixture）のときtrue。 */
  limited: boolean;
}

/** 共有の厳密規則にそろえる。前後空白・全角数字は可、無関係文字は不可。 */
export function normalizePostalQuery(value: unknown): string | null {
  return normalizePostalCodeDigits(value);
}

export function formatPostalHyphen(digits7: string): string {
  return `${digits7.slice(0, 3)}-${digits7.slice(3)}`;
}

export async function getPostalReadiness(db: D1Database): Promise<PostalReadiness> {
  const empty: PostalReadiness = {
    fullDataset: false,
    rowCount: 0,
    importedAt: null,
    source: null,
    expectedRows: null,
    inputSha256: null,
    complete: false,
    limited: false,
  };
  let manifest: {
    source_url: string;
    input_sha256: string;
    row_count: number;
    imported_at: string;
  } | null = null;
  try {
    manifest = await db.prepare(
      `SELECT source_url, input_sha256, row_count, imported_at
         FROM postal_import_manifest ORDER BY imported_at DESC LIMIT 1`,
    ).first<{
      source_url: string;
      input_sha256: string;
      row_count: number;
      imported_at: string;
    }>();
  } catch {
    manifest = null;
  }
  let count = 0;
  try {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM postal_codes').first<{ n: number }>();
    count = Number(row?.n ?? 0);
  } catch {
    count = 0;
  }
  if (!manifest) return { ...empty, rowCount: count };
  // 完了記録と件数が一致し、由来が公式配布のときだけ全国版と名乗る。
  const expected = Number(manifest.row_count);
  const complete = expected > 0 && count === expected;
  const limited = !manifest.source_url.startsWith('https://www.post.japanpost.jp');
  return {
    fullDataset: complete && !limited,
    rowCount: count,
    importedAt: manifest.imported_at ?? null,
    source: manifest.source_url ?? null,
    expectedRows: expected,
    inputSha256: manifest.input_sha256 ?? null,
    complete,
    limited,
  };
}

export async function searchPostalCodes(
  db: D1Database,
  digits7: string,
  fallback: PostalCodeCandidate[],
): Promise<{ candidates: PostalCodeCandidate[]; fromDb: boolean; total: number }> {
  try {
    // 同じ番号の候補は全部返す。件数での打ち切り（LIMIT）はしない。
    // 打ち切ると総数なしに欠落し、「潰さない」契約と矛盾するため。
    const result = await db.prepare(
      `SELECT postal_code AS postalCode, prefecture, city, town
         FROM postal_codes WHERE postal_code = ? ORDER BY prefecture, city, town`,
    ).bind(digits7).all<PostalCodeCandidate>();
    const rows = result.results ?? [];
    if (rows.length > 0) return { candidates: rows, fromDb: true, total: rows.length };
  } catch {
    // 表が無い環境（migration未反映）は下のfixtureへ倒す。
  }
  const hyphen = formatPostalHyphen(digits7);
  const hits = fallback.filter((row) => row.postalCode === digits7 || row.postalCode === hyphen);
  return { candidates: hits, fromDb: false, total: hits.length };
}
