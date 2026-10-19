import { type SegmentCondition } from '@line-crm/shared';
import { jstNow } from '../utils.js';
import { DEFAULT_MILEAGE_PROGRAM_ID, ensureBuiltInProgram, ensureDefaultMileageProgram } from './program.js';
import { type MileageRuleRow, type MileageRuleConditions, type PublishedEarningRuleContent } from './types.js';


export async function getMileageRules(
  db: D1Database,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageRuleRow[]> {
  await ensureBuiltInProgram(db, programId);
  const result = await db
    .prepare(
      `SELECT * FROM mileage_rules
        WHERE program_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .bind(programId)
    .all<MileageRuleRow>();
  return result.results;
}

export async function getMileageRuleById(
  db: D1Database,
  id: string,
): Promise<MileageRuleRow | null> {
  return db.prepare(`SELECT * FROM mileage_rules WHERE id = ?`).bind(id).first<MileageRuleRow>();
}

export async function createMileageRule(
  db: D1Database,
  input: {
    name: string;
    eventType: string;
    source?: string | null;
    amount: number;
    initialStatus?: 'pending' | 'available';
    conditions?: MileageRuleConditions | null;
    /** 期間限定のキャンペーン。列も突き合わせも前からあったが、書き込む口が無かった。 */
    validFrom?: string | null;
    validUntil?: string | null;
    /** 334(#521): 帰属アカウント。新規ルールでは必須。 */
    lineAccountId: string;
    /**
     * DRAFT-01: false なら最初のINSERTから停止(is_active=0)。未指定は従来どおり稼働。
     * 「作る→別APIで止める」にすると途中失敗で稼働中のルールが残るため、
     * 停止を指定した作成は1文で止まったまま入れる。
     */
    isActive?: boolean;
  },
): Promise<MileageRuleRow> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  if (!input.lineAccountId.trim()) {
    throw new Error('Mileage rule line account is required');
  }
  await ensureDefaultMileageProgram(db);
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO mileage_rules
         (id, program_id, name, event_type, source, amount, initial_status,
          conditions, line_account_id, is_active, valid_from, valid_until, created_at, updated_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.eventType,
      input.source ?? null,
      input.amount,
      input.initialStatus ?? 'available',
      input.conditions ? JSON.stringify(input.conditions) : null,
      input.lineAccountId,
      input.isActive === false ? 0 : 1,
      input.validFrom ?? null,
      input.validUntil ?? null,
      now,
      now,
    )
    .run();
  const created = await getMileageRuleById(db, id);
  if (!created) throw new Error('Failed to create mileage rule');
  return created;
}

/**
 * queue 行の snapshot を読む。壊れていたら NULL 扱い(=旧来どおり live 読み)にする。
 * 受付の安全は落とさず、処理だけが旧来動作へ退がる。
 */
export function parsePublishedSnapshot(value: string | null | undefined): Record<string, number> | null {
  if (value === null || value === undefined || value === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const map: Record<string, number> = {};
  for (const [key, version] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== 'string' || key === '') return null;
    if (!Number.isInteger(version) || (version as number) < 0) return null;
    map[key] = version as number;
  }
  return map;
}

export async function getPublishedVersionContent(
  db: D1Database,
  ruleId: string,
  versionNumber: number,
): Promise<PublishedEarningRuleContent | null> {
  const row = await db
    .prepare(
      `SELECT content_json FROM mileage_earning_rule_published_versions
        WHERE rule_id = ? AND version_number = ?`,
    )
    .bind(ruleId, versionNumber)
    .first<{ content_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.content_json) as PublishedEarningRuleContent;
  } catch {
    return null;
  }
}

export function publishedRuleContentFromDraft(
  draft: {
    name: string;
    eventType: string;
    source: string | null;
    amount: number;
    initialStatus: 'pending' | 'available';
    validFrom: string | null;
    validUntil: string | null;
    /** R52: 下書きの対象条件。そのまま公開版へ載せる(条件なしは null)。 */
    targetConditions?: SegmentCondition | null;
    /** m22o: 下書きの有効期限・取消・通知。そのまま公開版へ載せる。 */
    expiresAfterDays?: number | null;
    cancellationEventTypes?: string[];
    notification?: { enabled: boolean; messageTemplate: string } | null;
  },
  /** 下書きが持たない実行条件は、いまの live を引き継ぐ(消さない)。 */
  currentConditions: string | null,
): PublishedEarningRuleContent {
  const expiresAfterDays = draft.expiresAfterDays ?? null;
  const cancellations = Array.isArray(draft.cancellationEventTypes)
    ? [...new Set(draft.cancellationEventTypes.filter((item) => typeof item === 'string' && item.trim() !== ''))].slice(0, 10)
    : [];
  const notifyEnabled = draft.notification?.enabled === true
    && typeof draft.notification.messageTemplate === 'string'
    && draft.notification.messageTemplate.trim() !== '';
  return {
    name: draft.name,
    event_type: draft.eventType,
    source: draft.source,
    amount: draft.amount,
    initial_status: draft.initialStatus,
    conditions: currentConditions,
    target_conditions: draft.targetConditions ?? null,
    valid_from: draft.validFrom,
    valid_until: draft.validUntil,
    expires_after_days: Number.isInteger(expiresAfterDays) && (expiresAfterDays as number) > 0
      ? expiresAfterDays as number
      : null,
    cancellation_event_types: cancellations,
    notification: {
      enabled: notifyEnabled,
      messageTemplate: notifyEnabled ? (draft.notification as { messageTemplate: string }).messageTemplate : '',
    },
  };
}

/**
 * snapshot で固定された版を1ルール分だけ実行用の行にする。
 * version 0 は「受付時に未公開」。初公開で残した v0 があればそれを使い、
 * 無ければ live を使う(受付から初公開まで live は誰も書き換えられない)。
 * 行が無ければ null(適用しない)。
 * 停止・再開(is_active)はいまの live を見る。公開内容は変えない。
 */
export async function resolvePinnedRuleRow(
  db: D1Database,
  input: { ruleId: string; versionNumber: number },
): Promise<MileageRuleRow | null> {
  const live = await getMileageRuleById(db, input.ruleId);
  if (!live) return null;
  if (input.versionNumber <= 0) {
    const v0 = await getPublishedVersionContent(db, input.ruleId, 0);
    if (!v0) return live;
    return {
      ...live,
      name: v0.name,
      event_type: v0.event_type,
      source: v0.source,
      amount: v0.amount,
      initial_status: v0.initial_status,
      conditions: v0.conditions,
      // R52: 旧公開版の対象条件も引き継ぐ。無ければ null(条件なし)。
      target_conditions: v0.target_conditions ? JSON.stringify(v0.target_conditions) : null,
      valid_from: v0.valid_from,
      valid_until: v0.valid_until,
      // m22o: v0 は公開の仕組みができる前の live 写し。期限・取消・通知は持たない。
      expires_after_days: v0.expires_after_days ?? null,
      cancellation_event_types: v0.cancellation_event_types ?? [],
      notification: v0.notification ?? null,
    };
  }
  const content = await getPublishedVersionContent(db, input.ruleId, input.versionNumber);
  if (!content) return null;
  return {
    ...live,
    name: content.name,
    event_type: content.event_type,
    source: content.source,
    amount: content.amount,
    initial_status: content.initial_status,
    conditions: content.conditions,
    // R52: 公開版の対象条件を実行時の行へ載せる。無ければ null(条件なし)。
    target_conditions: content.target_conditions ? JSON.stringify(content.target_conditions) : null,
    valid_from: content.valid_from,
    valid_until: content.valid_until,
    // m22o: 公開版の期限・取消・通知を実行時の行へ載せる。古い公開版に
    // 項目が無いときは期限なし・取消なし・通知なしとして扱う。
    expires_after_days: content.expires_after_days ?? null,
    cancellation_event_types: content.cancellation_event_types ?? [],
    notification: content.notification ?? null,
  };
}

export async function updateMileageRule(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    eventType: string;
    source: string | null;
    amount: number;
    initialStatus: 'pending' | 'available';
    conditions: MileageRuleConditions | null;
    isActive: boolean;
    validFrom: string | null;
    validUntil: string | null;
  }>,
): Promise<MileageRuleRow | null> {
  if (updates.amount !== undefined && (!Number.isInteger(updates.amount) || updates.amount <= 0)) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.source !== undefined) { sets.push('source = ?'); values.push(updates.source); }
  if (updates.amount !== undefined) { sets.push('amount = ?'); values.push(updates.amount); }
  if (updates.initialStatus !== undefined) { sets.push('initial_status = ?'); values.push(updates.initialStatus); }
  if (updates.conditions !== undefined) {
    sets.push('conditions = ?');
    values.push(updates.conditions ? JSON.stringify(updates.conditions) : null);
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.validFrom !== undefined) { sets.push('valid_from = ?'); values.push(updates.validFrom); }
  if (updates.validUntil !== undefined) { sets.push('valid_until = ?'); values.push(updates.validUntil); }
  if (sets.length === 0) return getMileageRuleById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE mileage_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getMileageRuleById(db, id);
}

/**
 * 決めごとを履歴ごと消さないための原子削除。N-232 用。
 * 台帳(mileage_ledger)に1件でも参照があれば消さない。void の行も数える。
 * SELECTとDELETEを分けると、その間に付与履歴が作られる競合で履歴付き決めごとを
 * 消せるため、DELETE文自体に NOT EXISTS 条件を持たせて1文で実行する。
 * 戻り値は消えた件数。0なら履歴あり・存在しない・同時削除のいずれかで、呼び出し側は安全拒否する。
 */
export async function deleteMileageRule(db: D1Database, id: string): Promise<number> {
  /*
   * R296: の決めごとは下書き行が mileage_rules への FK を持つので、
   * 下書きを残したまま本体を消すと外部キー違反で落ちる。先に下書きを消す。
   * 両文に履歴ガードを付けて1トランザクション(batch)で送る——下書きだけ
   * 消えて本体が残ると、一覧に出ないのに付与が動く決めごとになる。
   */
  const [, deleted] = await db.batch([
    db.prepare(
      `DELETE FROM mileage_earning_rule_drafts
        WHERE rule_id = ?
          AND NOT EXISTS (SELECT 1 FROM mileage_ledger WHERE mileage_rule_id = ?)`,
    ).bind(id, id),
    db.prepare(
      `DELETE FROM mileage_rules
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM mileage_ledger WHERE mileage_rule_id = ?)`,
    ).bind(id, id),
  ]);
  return deleted.meta?.changes ?? 0;
}
