import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { jstNow } from '../utils.js';
import { type CommonVarExpiryBehavior, type CommonVar } from './record-types.js';
import { getCommonVarById, CommonVarVersionConflictError, CommonVarReasonRequiredError, assertCommonVarFolder, CommonVarStatusTransitionError, getCommonVarByIdIncludingArchived } from './definitions.js';
import { type CommonVarExpiryCandidate, type CommonVarVersion } from './types.js';


export const EXPIRY_BEHAVIOR_LABELS: Record<CommonVarExpiryBehavior, string> = {
  stop: '配信を止める',
  fallback: '代替値を使う',
};

/** 履歴に残す期間表示。DBのUTC ISOを、画面と同じ日本時間の短い形に直す。 */
export function formatVarStampJst(value: string | null): string {
  if (!value) return '制限なし';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const jst = japanCalendar(new Date(ms));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

export function clipVarValue(value: string | null): string {
  if (!value) return '（空）';
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

/*
 * 履歴（common_var_versions）には名前・値・メモ・理由の列しかない。
 * 有効期間や代替値だけを変えた保存は「同じ値→同じ値」に見えて、
 * 期間の変更がどこにも残らない。列を足すmigrationなしで追えるよう、
 * 変わった項目と前後を理由の末尾へ併記する。値そのものは versions の
 * value 列に残るので、ここでは期間・動作・置き場所などの内訳を書く。
 */
export function describeCommonVarChanges(
  existing: CommonVar,
  input: {
    folderId?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    fallbackValue?: string | null;
    expiryBehavior?: CommonVarExpiryBehavior;
  },
): string {
  // 名前・値・メモは版行の列に残るので併記しない。残らない項目だけ書く。
  const changes: string[] = [];
  if ('folderId' in input && (input.folderId ?? null) !== existing.folder_id) {
    changes.push('置き場所');
  }
  if ('validFrom' in input && (input.validFrom ?? null) !== existing.valid_from) {
    changes.push(`有効開始 ${formatVarStampJst(existing.valid_from)}→${formatVarStampJst(input.validFrom ?? null)}`);
  }
  if ('validUntil' in input && (input.validUntil ?? null) !== existing.valid_until) {
    changes.push(`有効終了 ${formatVarStampJst(existing.valid_until)}→${formatVarStampJst(input.validUntil ?? null)}`);
  }
  if (input.expiryBehavior !== undefined && input.expiryBehavior !== existing.expiry_behavior) {
    changes.push(
      `期間外の動作「${EXPIRY_BEHAVIOR_LABELS[existing.expiry_behavior]}」→「${EXPIRY_BEHAVIOR_LABELS[input.expiryBehavior]}」`,
    );
  }
  if ('fallbackValue' in input && (input.fallbackValue ?? null) !== existing.fallback_value) {
    changes.push(`代替値「${clipVarValue(existing.fallback_value)}」→「${clipVarValue(input.fallbackValue ?? null)}」`);
  }
  return changes.join('・');
}

export async function updateCommonVar(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: {
    name?: string;
    value?: string;
    memo?: string;
    folderId?: string | null;
    expectedVersion?: number;
    actorId?: string | null;
    changeReason?: string;
    validFrom?: string | null;
    validUntil?: string | null;
    fallbackValue?: string | null;
    expiryBehavior?: CommonVarExpiryBehavior;
  },
): Promise<CommonVar | null> {
  const existing = await getCommonVarById(db, id, lineAccountId);
  if (!existing) return null;
  if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
    throw new CommonVarVersionConflictError(existing.version);
  }
  // Q: 変える理由は必須。「編集」のような自動補完だと、後から
  // なぜ変えたか追えなくなる。予約適用のような内部呼出しは
  // この関数を通さず、専用の履歴文言を直接書き込む。
  const changeReason = input.changeReason?.trim();
  if (!changeReason) throw new CommonVarReasonRequiredError();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.value !== undefined) {
    sets.push('value = ?');
    values.push(input.value);
  }
  if (input.memo !== undefined) {
    sets.push('memo = ?');
    values.push(input.memo);
  }
  if ('folderId' in input) {
    if (input.folderId) await assertCommonVarFolder(db, input.folderId);
    sets.push('folder_id = ?');
    values.push(input.folderId ?? null);
  }
  if ('validFrom' in input) {
    sets.push('valid_from = ?');
    values.push(input.validFrom ?? null);
  }
  if ('validUntil' in input) {
    sets.push('valid_until = ?');
    values.push(input.validUntil ?? null);
    // 期限を延ばした・直したときは、新しい期限へ向けて14日前・3日前の
    // 知らせをやり直す（Q）。送った印だけ消し、値が変わらないときは触らない。
    if ((input.validUntil ?? null) !== existing.valid_until) {
      sets.push('expiry_notice_14_at = NULL', 'expiry_notice_3_at = NULL');
    }
  }
  if ('fallbackValue' in input) {
    sets.push('fallback_value = ?');
    values.push(input.fallbackValue ?? null);
  }
  if (input.expiryBehavior !== undefined) {
    sets.push('expiry_behavior = ?');
    values.push(input.expiryBehavior);
  }
  if (sets.length > 0) {
    const now = jstNow();
    const nextVersion = existing.version + 1;
    // 期間や代替値だけの変更が「同じ値→同じ値」に見えないよう、
    // 変えた項目の内訳を理由へ併記する（describeCommonVarChanges）。
    const changeDetail = describeCommonVarChanges(existing, input);
    const storedReason = changeDetail ? `${changeReason}（変更: ${changeDetail}）` : changeReason;
    sets.push('version = ?', 'updated_by = ?', 'updated_at = ?');
    values.push(nextVersion, input.actorId ?? null, now, id, lineAccountId, existing.version);
    const results = await db.batch([
      db.prepare(
        `UPDATE common_vars SET ${sets.join(', ')}
          WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(...values),
      db.prepare(
        `INSERT INTO common_var_versions
           (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), id, nextVersion,
        input.name ?? existing.name,
        input.value ?? existing.value,
        input.memo ?? existing.memo,
        storedReason,
        input.actorId ?? null,
        now,
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) === 0) {
      throw new CommonVarVersionConflictError(
        (await getCommonVarById(db, id, lineAccountId))?.version ?? existing.version,
      );
    }
  }
  return getCommonVarById(db, id, lineAccountId);
}

/**
 * 状態の切替（Q）。下書き→使用中（公開）、使用中→止めた、止めた→使用中（再開）。
 * 使用中へ戻る経路は使える状態を作るので理由を必須にし、止める経路は
 * 「なぜ止めたか」を後から追えるよう同じく理由を必須にする。
 * 版を1つ足して履歴に残す。既にアーカイブ済み・存在しないものは null。
 */
export async function setCommonVarStatus(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: {
    to: 'active' | 'stopped';
    actorId?: string | null;
    changeReason?: string;
    expectedVersion?: number;
  },
): Promise<CommonVar | null> {
  const existing = await getCommonVarById(db, id, lineAccountId);
  if (!existing) return null;
  if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
    throw new CommonVarVersionConflictError(existing.version);
  }
  const changeReason = input.changeReason?.trim();
  if (!changeReason) throw new CommonVarReasonRequiredError();
  const from = existing.status;
  const allowed =
    (input.to === 'active' && (from === 'draft' || from === 'stopped'))
    || (input.to === 'stopped' && from === 'active');
  if (!allowed) throw new CommonVarStatusTransitionError(from, input.to);
  const now = jstNow();
  const nextVersion = existing.version + 1;
  const results = await db.batch([
    db.prepare(
      `UPDATE common_vars
          SET status = ?, stopped_at = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at IS NULL`,
    ).bind(input.to, input.to === 'stopped' ? now : null, nextVersion,
      input.actorId ?? null, now, id, lineAccountId, existing.version),
    db.prepare(
      `INSERT INTO common_var_versions
         (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, nextVersion,
      existing.name, existing.value, existing.memo,
      changeReason, input.actorId ?? null, now,
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) {
    throw new CommonVarVersionConflictError(
      (await getCommonVarById(db, id, lineAccountId))?.version ?? existing.version,
    );
  }
  return getCommonVarById(db, id, lineAccountId);
}

/**
 * 期限14日前・3日前の知らせがまだの共通情報を拾う（Q）。
 * 使用中で有効終了が未来のものだけ。止めた・下書き・アーカイブ済みは
 * 送っても動かせないので対象にしない。
 */
export async function listCommonVarExpiryCandidates(
  db: D1Database,
  nowIso: string,
): Promise<CommonVarExpiryCandidate[]> {
  const in14Days = new Date(Date.parse(nowIso) + 14 * 24 * 3600_000).toISOString();
  const result = await db.prepare(
    `SELECT id, line_account_id, name, var_key, valid_until,
            expiry_notice_14_at, expiry_notice_3_at
       FROM common_vars
      WHERE archived_at IS NULL
        AND status = 'active'
        AND valid_until IS NOT NULL
        AND valid_until > ?
        AND valid_until <= ?
        AND (expiry_notice_14_at IS NULL OR expiry_notice_3_at IS NULL)`,
  ).bind(nowIso, in14Days).all<CommonVarExpiryCandidate>();
  return result.results;
}

/**
 * 知らせを出した印を打つ。印がまだの行だけ更新するので、
 * 同じ知らせを2回出す競合が起きても1回しか記録されない。
 * 戻り値が0なら別の実行が先に印を打っている。
 */
export async function markCommonVarExpiryNotice(
  db: D1Database,
  id: string,
  kind: '14d' | '3d',
  sentAt: string,
): Promise<boolean> {
  const column = kind === '14d' ? 'expiry_notice_14_at' : 'expiry_notice_3_at';
  const result = await db.prepare(
    `UPDATE common_vars SET ${column} = ?
      WHERE id = ? AND ${column} IS NULL`,
  ).bind(sentAt, id).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function getCommonVarVersions(
  db: D1Database,
  commonVarId: string,
  lineAccountId: string,
  limit = 20,
): Promise<CommonVarVersion[]> {
  const result = await db.prepare(
    `SELECT v.*, sm.name AS actor_name
       FROM common_var_versions v
       JOIN common_vars cv ON cv.id = v.common_var_id
       LEFT JOIN staff_members sm ON sm.id = v.actor_id
      WHERE v.common_var_id = ? AND cv.line_account_id = ?
      ORDER BY v.version_no DESC
      LIMIT ?`,
  ).bind(commonVarId, lineAccountId, Math.max(1, Math.min(limit, 100))).all<CommonVarVersion>();
  return result.results;
}

export async function deleteCommonVar(
  db: D1Database,
  id: string,
  lineAccountId: string,
  actorId: string | null,
  changeReason: string,
): Promise<void> {
  const existing = await getCommonVarById(db, id, lineAccountId);
  if (!existing) return;
  const reason = changeReason.trim();
  if (!reason) throw new CommonVarReasonRequiredError();
  const now = jstNow();
  const nextVersion = existing.version + 1;
  const results = await db.batch([
    db.prepare(
      `UPDATE common_vars
          SET archived_at = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at IS NULL`,
    ).bind(now, nextVersion, actorId, now, id, lineAccountId, existing.version),
    db.prepare(
      `INSERT INTO common_var_versions
         (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM common_vars
           WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at = ?
        )`,
    ).bind(
      crypto.randomUUID(), id, nextVersion, existing.name, existing.value, existing.memo,
      reason, actorId, now,
      id, lineAccountId, nextVersion, now,
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) {
    throw new CommonVarVersionConflictError(
      (await getCommonVarByIdIncludingArchived(db, id, lineAccountId))?.version ?? existing.version,
    );
  }
}
