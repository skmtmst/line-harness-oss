import { jstNow } from './utils.js';

/**
 * マニュアルの正本表。設計 ★V6 34-4（`f9oUm`）。台帳 #134。
 *
 * **運営だけが直す。** お客さまの組織ごとには変えない（要件 v6-34 §8-2）。
 */

export type ManualLinkStatus = 'ok' | 'broken' | 'unset';

export interface ManualLinkRow {
  key: string;
  key_kind: 'screen' | 'task';
  name: string;
  url: string | null;
  status: ManualLinkStatus;
  last_checked_at: string | null;
  last_error: string | null;
  updated_by: string | null;
  updated_at: string;
}

/**
 * URL と確認結果から状態を決める。
 *
 * **「決めていない」と「開けない」を言い分ける。**
 * どちらもマニュアルは開かないが、運営のやることが違う——
 * 前者は決める、後者は直す。
 *
 * **確かめていない URL を「開けます」と言わない。** URL が入っているだけでは、
 * 開けるかどうかは分からない。
 */
export function statusFor(url: string | null | undefined, checkedOk: boolean | null): ManualLinkStatus {
  if (!url || url.trim() === '') return 'unset';
  if (checkedOk === null) return 'unset';
  return checkedOk ? 'ok' : 'broken';
}

export async function listManualLinks(db: D1Database): Promise<ManualLinkRow[]> {
  const result = await db
    .prepare(`SELECT * FROM manual_links ORDER BY key_kind, key`)
    .all<ManualLinkRow>();
  return result.results;
}

export async function getManualLink(db: D1Database, key: string): Promise<ManualLinkRow | null> {
  return db.prepare(`SELECT * FROM manual_links WHERE key = ?`).bind(key).first<ManualLinkRow>();
}

/**
 * 1行を直す。
 *
 * **URL を変えたら状態を `unset` に戻す。** 前の URL を確かめた結果が
 * 新しい URL にも当てはまるとは限らない。確かめ直すまで「開けます」と言わない。
 */
export async function upsertManualLink(
  db: D1Database,
  input: {
    key: string;
    keyKind: 'screen' | 'task';
    name: string;
    url: string | null;
    updatedBy?: string | null;
  },
): Promise<void> {
  const url = input.url && input.url.trim() !== '' ? input.url.trim() : null;
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO manual_links (key, key_kind, name, url, status, last_checked_at, last_error, updated_by, updated_at)
       VALUES (?, ?, ?, ?, 'unset', NULL, NULL, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         key_kind = excluded.key_kind,
         name = excluded.name,
         url = excluded.url,
         status = CASE WHEN manual_links.url IS excluded.url THEN manual_links.status ELSE 'unset' END,
         last_checked_at = CASE WHEN manual_links.url IS excluded.url THEN manual_links.last_checked_at ELSE NULL END,
         last_error = CASE WHEN manual_links.url IS excluded.url THEN manual_links.last_error ELSE NULL END,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(input.key, input.keyKind, input.name, url, input.updatedBy ?? null, now)
    .run();
}

export async function recordCheck(
  db: D1Database,
  key: string,
  result: { ok: boolean; error?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE manual_links
          SET status = ?, last_checked_at = ?, last_error = ?
        WHERE key = ? AND url IS NOT NULL`,
    )
    .bind(result.ok ? 'ok' : 'broken', jstNow(), result.error ?? null, key)
    .run();
}

/** 開けないリンクの数。**0 件のときは画面で何も言わない。** */
export async function countBroken(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM manual_links WHERE status = 'broken'`)
    .first<{ c: number }>();
  return row?.c ?? 0;
}
