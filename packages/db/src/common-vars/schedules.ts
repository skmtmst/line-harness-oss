import { jstNow } from '../utils.js';
import { getAccountSetting, getVersionedAccountSetting } from '../account-settings.js';
import { type CommonVarSchedule } from './types.js';


/** 差し込み用に key => value でまとめて返す。 */
export async function getCommonVarMap(
  db: D1Database,
  lineAccountId: string | null | undefined,
): Promise<Record<string, string>> {
  if (!lineAccountId) return {};
  const result = await db
    .prepare(`SELECT var_key, value FROM common_vars WHERE line_account_id = ? AND archived_at IS NULL`)
    .bind(lineAccountId)
    .all<{ var_key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of result.results) out[row.var_key] = row.value;
  return out;
}

// --- 日付での切り替え ---------------------------------------------------

export async function getCommonVarSchedules(
  db: D1Database,
  varId: string,
): Promise<CommonVarSchedule[]> {
  const result = await db
    .prepare(
      `SELECT * FROM common_var_schedules WHERE var_id = ? ORDER BY effective_from ASC`,
    )
    .bind(varId)
    .all<CommonVarSchedule>();
  return result.results;
}

export async function createCommonVarSchedule(
  db: D1Database,
  input: { varId: string; effectiveFrom: string; value: string },
): Promise<CommonVarSchedule> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO common_var_schedules (id, var_id, effective_from, value, applied_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .bind(id, input.varId, input.effectiveFrom, input.value)
    .run();
  return (await db
    .prepare(`SELECT * FROM common_var_schedules WHERE id = ?`)
    .bind(id)
    .first<CommonVarSchedule>())!;
}

export async function deleteCommonVarSchedule(
  db: D1Database,
  id: string,
  varId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM common_var_schedules WHERE id = ? AND var_id = ?`).bind(id, varId).run();
}

/**
 * 予約した切り替えを反映する。Cron から呼ぶ。
 *
 * applied_at が NULL の行だけを見るので、二度反映されない。
 * 同じ変数に複数の予約が溜まっている場合は古い順に当て、最後のものが残る。
 * 途中を飛ばすと「一度も適用されなかった値」が残るので、順番に当てる。
 */
/**
 * このアカウントで共通情報が有効か。worker の accountFeatureIsEnabled と
 * 同じ順序(一括設定→個別設定→初期値)で読む。正本は worker 側にあり、
 * ここは dispatcher が db 層だけで止めるための最小複製。
 */
export async function isCommonVarsEnabled(db: D1Database, accountId: string): Promise<boolean> {
  const bundle = await getVersionedAccountSetting<{ features?: Record<string, unknown> }>(
    db,
    accountId,
    'feature.settings_bundle_v1',
  );
  const fromBundle = bundle?.data.features?.['common_vars'];
  if (typeof fromBundle === 'boolean') return fromBundle;
  const legacy = await getAccountSetting(db, accountId, 'feature.common_vars');
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as { enabled?: unknown };
      if (typeof parsed.enabled === 'boolean') return parsed.enabled;
    } catch {
      // 壊れた値は初期値に倒す。
    }
  }
  return true;
}

export async function applyDueCommonVarSchedules(
  db: D1Database,
  now: string,
  limit = 1_000,
): Promise<number> {
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), 1_000))
    : 1_000;
  const due = await db
    .prepare(
      `SELECT * FROM common_var_schedules
        WHERE applied_at IS NULL AND effective_from <= ?
        ORDER BY effective_from ASC, id ASC
        LIMIT ?`,
    )
    .bind(now, batchLimit)
    .all<CommonVarSchedule>();
  let applied = 0;
  for (const row of due.results) {
    // 適用のたびに版を1つ進め、履歴に1行残す。値・版・履歴・適用済み印を
    // 同じ batch にして、途中で落ちたら「値だけ変わって記録なし」にしない。
    // 版の一致を条件に入れるので、利用者の同時編集とぶつかった回は
    // 何も書かず、次回の Cron で当て直す。
    const current = await db
      .prepare(
        `SELECT name, value, memo, version, line_account_id FROM common_vars
          WHERE id = ? AND archived_at IS NULL`,
      )
      .bind(row.var_id)
      .first<{ name: string; value: string; memo: string | null; version: number; line_account_id: string | null }>();
    // 機能オフ中は適用せず未適用のまま残す。再オンで再開する。
    // 正本は services/feature-enforcement.ts の accountFeatureIsEnabled。
    if (current?.line_account_id && !await isCommonVarsEnabled(db, current.line_account_id)) {
      continue;
    }
    const stamp = jstNow();
    if (!current) {
      // 変数自体が無い(削除済み等)の予約は、繰り返し拾わないよう印だけ打つ。
      await db
        .prepare(`UPDATE common_var_schedules SET applied_at = ? WHERE id = ?`)
        .bind(stamp, row.id)
        .run();
      applied++;
      continue;
    }
    const nextVersion = current.version + 1;
    const results = await db.batch([
      // SELECT後からbatch開始までに画面保存が入っていたら、意図的にSQLエラーを
      // 起こしてbatch全体を戻す。batch内は同一トランザクションなので、この確認後に
      // 値・履歴・適用済み印が分かれることはない。
      db.prepare(
        `SELECT CASE WHEN EXISTS (
           SELECT 1 FROM common_vars
            WHERE id = ? AND version = ? AND archived_at IS NULL
         ) THEN 1 ELSE json('') END AS version_is_current`,
      ).bind(row.var_id, current.version),
      db.prepare(
        `UPDATE common_vars SET value = ?, version = ?, updated_by = NULL, updated_at = ?
          WHERE id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(row.value, nextVersion, stamp, row.var_id, current.version),
      db.prepare(
        `INSERT INTO common_var_versions
           (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM common_vars
             WHERE id = ? AND version = ? AND archived_at IS NULL
          )`,
      ).bind(
        crypto.randomUUID(), row.var_id, nextVersion,
        current.name, row.value, current.memo ?? '',
        '予約適用', null, stamp,
        row.var_id, nextVersion,
      ),
      db.prepare(
        `UPDATE common_var_schedules SET applied_at = ?
          WHERE id = ? AND applied_at IS NULL AND EXISTS (
            SELECT 1 FROM common_vars
             WHERE id = ? AND version = ? AND archived_at IS NULL
          )`,
      ).bind(stamp, row.id, row.var_id, nextVersion),
    ]);
    if ((results[1].meta?.changes ?? 0) > 0) applied++;
  }
  return applied;
}
