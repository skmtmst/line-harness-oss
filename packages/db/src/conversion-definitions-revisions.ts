import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { jstNow } from './utils.js';
import { type ConversionDefinitionScope, type ConversionDefinitionStatus, type RevisionRow, type DefinitionConfig, type ReviseConversionDefinitionInput } from './conversion-definitions-types.js';
import { getConversionDefinitionDetail, accountWhere, ConversionDefinitionError } from './conversion-definitions-reads.js';
import { conversionFolder } from './conversion-definitions-reports.js';


export async function getConversionDefinitionDeleteImpact(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
) {
  const definition = await getConversionDefinitionDetail(db, id, scope);
  if (!definition) return null;
  const eventRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_events WHERE conversion_point_id = ?')
    .bind(id).first<{ total: number }>();
  const account = accountWhere('cp.', scope, undefined);
  /*
   * N-261: 差替え候補は同じ種類の成果地点だけを出す。
   * 起点の種類・計測方法・対象URLが違う地点へ利用先を移すと、
   * 利用先が見ているものと別の意味の成果を数え始める。
   * 候補一覧が本実行と同じ条件で絞られていれば、画面で違う種類を
   * 選ぶこと自体が起きない。
   */
  const replacements = await db.prepare(`SELECT cp.id, cp.name, cp.version
    FROM conversion_points cp
    WHERE cp.id <> ? AND cp.status = 'active'
      AND cp.event_type = ? AND cp.measure_method = ? AND cp.target_url IS ?
      AND ${account.sql}
    ORDER BY cp.name ASC LIMIT 20`)
    .bind(
      id,
      definition.sourceType,
      definition.measureMethod,
      definition.targetUrl,
      ...account.values,
    )
    .all<{ id: string; name: string; version: number }>();
  const eventCount = Number(eventRow?.total ?? 0);
  return {
    definition,
    usages: definition.usages,
    eventCount,
    canDelete: definition.usages.length === 0 && eventCount === 0,
    stopImpact: {
      affectedUsageCount: definition.usages.length,
      preservesPastEvents: true,
      preservesUsages: true,
    },
    replacementCandidates: replacements.results.map((row) => ({
      id: row.id, name: row.name, version: Number(row.version),
    })),
  };
}

export async function currentDefinitionForMutation(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
): Promise<{
  id: string; version: number; status: ConversionDefinitionStatus;
  line_account_id: string | null;
  event_type: string; measure_method: string; target_url: string | null;
} | null> {
  const account = accountWhere('cp.', scope, undefined);
  return db.prepare(`SELECT cp.id, cp.version, cp.status, cp.line_account_id,
      cp.event_type, cp.measure_method, cp.target_url
    FROM conversion_points cp WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, ...account.values)
    .first();
}

export function requireExpectedDefinition(
  row: { version: number; status: ConversionDefinitionStatus } | null,
  expectedVersion: number,
  options?: { allowDraft?: boolean },
) {
  if (!row) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(row.version) !== expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (row.status === 'stopped') {
    throw new ConversionDefinitionError('definition_stopped', '成果地点はすでに停止しています', 409);
  }
  if (row.status === 'draft' && !options?.allowDraft) {
    throw new ConversionDefinitionError('definition_draft', '成果地点はまだ下書きです。公開してから操作してください', 409);
  }
}

export async function stopConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const now = jstNow();
  const usageRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .bind(input.id).first<{ total: number }>();
  const operationId = crypto.randomUUID();
  // D1 batchは1文でも失敗すれば全体をrollbackする。CAS直後のchanges()が1の
  // ときだけログを作るため、競合したbatchは副作用0のまま終わる。
  const results = await db.batch([
    db.prepare(`UPDATE conversion_points SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('active', 'draft')`)
      .bind(now, now, input.id, input.expectedVersion),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'stop', NULL, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, Number(usageRow?.total ?? 0), input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'stopped' as const, version: input.expectedVersion + 1, stoppedAt: now };
}

export function configOf(row: RevisionRow): DefinitionConfig {
  return {
    name: row.name,
    sourceType: row.event_type,
    sourceConfig: JSON.parse(row.source_config_json || '{}') as Record<string, unknown>,
    measureMethod: row.measure_method,
    targetUrl: row.target_url,
    deduplicationMode: row.deduplication_mode,
    deduplicationWindowDays: row.deduplication_window_days,
    valueMode: row.value_mode,
    fixedValue: row.value,
    reversalPolicy: row.reversal_policy,
    attributionDays: row.attribution_days,
  };
}

/**
 * 成果地点を、履歴を保ったまま編集して次の版にする（N-252）。
 *
 * **過去の成果は書き換えない。** 集計は `conversion_events.value_snapshot` を
 * 見ており、計測時の版は `point_version_snapshot` に残る。だから編集しても
 * 過去の集計額は動かない。
 *
 * **利用先は安定ID（`conversion_point_id`）のまま次の版へ付け替える。**
 * 参照が切れないよう、地点の版を上げるのと同じ処理の中で `definition_version`
 * を進める。
 *
 * **後勝ちにしない。** `stopConversionDefinition` と同じ形で、版のCASに勝った
 * ときだけ監査と利用先が動く。負けた側は 409 で、副作用は0のまま終わる
 * （D1 の batch は1文でも失敗すれば全体を rollback する。ここでは失敗ではなく
 * 「0件更新」で表すので、後段の文も同じ条件で自分を止める）。
 */
export async function reviseConversionDefinition(
  db: D1Database,
  input: ReviseConversionDefinitionInput,
) {
  const account = accountWhere('cp.', input.scope, undefined);
  const current = await db.prepare(`SELECT cp.id, cp.version, cp.status, cp.line_account_id,
      cp.name, cp.event_type, cp.value, cp.measure_method, cp.target_url, cp.count_repeat,
      cp.attribution_days, cp.source_config_json, cp.deduplication_mode,
      cp.deduplication_window_days, cp.value_mode, cp.reversal_policy
    FROM conversion_points cp WHERE cp.id = ? AND ${account.sql}`)
    .bind(input.id, ...account.values)
    .first<RevisionRow>();
  // N-268: 下書きも編集できる。版を進めても status は draft のまま。
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const row = current!;
  const folderId = await conversionFolder(db, row.line_account_id, input.folderId);

  const name = input.name.trim();
  if (!name) throw new ConversionDefinitionError('required', '成果地点の名前を入れてください', 400);
  // 同じ店の中で名前が重ならないこと。自分自身は除く（名前を変えない編集を弾かない）。
  const duplicate = await db.prepare(`SELECT id FROM conversion_points
    WHERE line_account_id IS ? AND lower(trim(name)) = lower(trim(?)) AND id != ? LIMIT 1`)
    .bind(row.line_account_id, name, input.id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new ConversionDefinitionError('duplicate_name', '同じ名前の成果地点があります', 409);
  }

  const after: DefinitionConfig = {
    name,
    sourceType: input.sourceType,
    sourceConfig: input.sourceConfig,
    measureMethod: input.measureMethod,
    targetUrl: input.measureMethod === 'url_reach' ? input.targetUrl ?? null : null,
    deduplicationMode: input.deduplicationMode,
    deduplicationWindowDays: input.deduplicationMode === 'window'
      ? input.deduplicationWindowDays ?? null : null,
    valueMode: input.valueMode,
    fixedValue: input.valueMode === 'fixed' ? input.fixedValue ?? null : null,
    reversalPolicy: input.reversalPolicy,
    attributionDays: input.attributionDays ?? null,
  };
  const before = configOf(row);
  const toVersion = input.expectedVersion + 1;
  const now = jstNow();
  const revisionId = crypto.randomUUID();
  const usageRow = await db.prepare(`SELECT COUNT(*) AS total FROM conversion_definition_usages
    WHERE conversion_point_id = ? AND definition_version = ?`)
    .bind(input.id, input.expectedVersion).first<{ total: number }>();
  const affectedUsages = Number(usageRow?.total ?? 0);

  const results = await db.batch([
    db.prepare(`UPDATE conversion_points
        SET name = ?, event_type = ?, value = ?, measure_method = ?, target_url = ?,
            count_repeat = ?, attribution_days = ?, source_config_json = ?,
            deduplication_mode = ?, deduplication_window_days = ?, value_mode = ?,
            reversal_policy = ?, updated_at = ?, version = version + 1,
            folder_id = CASE WHEN ? THEN ? ELSE folder_id END
      /*
       * 事前検査(requireExpectedDefinition)が下書きも編集可と判定するのに、
       * CAS が active だけを通すと、下書きの正常編集が必ず0件更新→409に
       * 倒れる(CONVERSION-07)。許可した状態と照合条件は常に一致させる。
       */
      WHERE id = ? AND version = ? AND status IN ('active', 'draft')`)
      .bind(
        after.name, after.sourceType, after.fixedValue, after.measureMethod, after.targetUrl,
        after.deduplicationMode === 'every' ? 1 : 0, after.attributionDays,
        JSON.stringify(after.sourceConfig), after.deduplicationMode,
        after.deduplicationWindowDays, after.valueMode, after.reversalPolicy,
        now, folderId !== undefined ? 1 : 0, folderId ?? null, input.id, input.expectedVersion,
      ),
    // CASに勝ったときだけ監査を残す。負けた batch は行を1つも作らない。
    db.prepare(`INSERT INTO conversion_definition_revisions
      (id, conversion_point_id, from_version, to_version, before_config_json,
       after_config_json, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(
        revisionId, input.id, input.expectedVersion, toVersion,
        JSON.stringify(before), JSON.stringify(after), affectedUsages,
        input.reason ?? null, input.staffId, now,
      ),
    /*
     * 利用先を次の版へ付け替える。
     *
     * `changes()` は直前の文（監査のINSERT）を指すので、ここでは使えない。
     * 監査行そのものの有無を条件にする。CASに負けた batch では監査行が
     * 作られないため、この UPDATE も0件で終わり、利用先の版だけが
     * 先に進んでしまうことがない。
     */
    db.prepare(`UPDATE conversion_definition_usages
        SET definition_version = ?, updated_at = ?
      WHERE conversion_point_id = ? AND definition_version = ?
        AND EXISTS (SELECT 1 FROM conversion_definition_revisions
                     WHERE conversion_point_id = ? AND to_version = ?)`)
      .bind(toVersion, now, input.id, input.expectedVersion, input.id, toVersion),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return {
    id: input.id,
    version: toVersion,
    revisionId,
    movedUsages: Number(results[2]?.meta.changes ?? 0),
    updatedAt: now,
  };
}

export async function replaceConversionDefinitionUsages(
  db: D1Database,
  input: { id: string; replacementId: string; scope: ConversionDefinitionScope; expectedVersion: number; replacementExpectedVersion: number; reason?: string | null; staffId: string },
) {
  if (input.id === input.replacementId) {
    throw new ConversionDefinitionError('invalid_replacement', '別の成果地点を選んでください', 400);
  }
  const [source, replacement] = await Promise.all([
    currentDefinitionForMutation(db, input.id, input.scope),
    currentDefinitionForMutation(db, input.replacementId, input.scope),
  ]);
  // 差し替え元が下書きでも利用先を逃がせる。差し替え先は計測中に限る。
  requireExpectedDefinition(source, input.expectedVersion, { allowDraft: true });
  requireExpectedDefinition(replacement, input.replacementExpectedVersion);
  if (source!.line_account_id !== replacement!.line_account_id) {
    throw new ConversionDefinitionError('account_mismatch', '同じLINEアカウントの成果地点を選んでください', 409);
  }
  /*
   * N-261: 種類の違う成果地点へは差し替えられない。
   * 起点の種類・計測方法・対象URLが一致する地点だけを置き換え先にする。
   * 違う種類へ利用先を移すと、「注文が確定した成果」を見ていた分析が
   * いきなり「ページを見た成果」を数え始めるような取り違えになる。
   * 事前検査だけでは同時更新に負けることがあるので、同じ条件は後段の
   * CAS文の EXISTS にも入れてある。
   */
  if (
    source!.event_type !== replacement!.event_type
    || source!.measure_method !== replacement!.measure_method
    || source!.target_url !== replacement!.target_url
  ) {
    throw new ConversionDefinitionError(
      'incompatible_source_type',
      '同じ種類の成果地点を選んでください。起点・計測方法・対象ページが同じ地点にだけ差し替えられます',
      409,
    );
  }
  const usageRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .bind(input.id).first<{ total: number }>();
  const affectedUsages = Number(usageRow?.total ?? 0);
  const now = jstNow();
  const operationId = crypto.randomUUID();
  // 事前確認は読んだ瞬間の姿でしかない。置換先を別の要求が停止・版更新・削除
  // しても旧地点のCASだけなら通ってしまい、利用先が停止済みや旧版の置換先へ
  // 移る。置換先のID・版・稼働中・同アカウントを旧地点のCAS文そのものへ
  // EXISTSで入れ、同じtransaction内で1文として固定する。
  const results = await db.batch([
    db.prepare(`UPDATE conversion_points AS source SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1
      WHERE source.id = ? AND source.version = ? AND source.status IN ('active', 'draft')
        AND EXISTS (
          SELECT 1 FROM conversion_points AS replacement
          WHERE replacement.id = ? AND replacement.version = ?
            AND replacement.status = 'active' AND replacement.id <> source.id
            AND (replacement.line_account_id = source.line_account_id
              OR (replacement.line_account_id IS NULL AND source.line_account_id IS NULL))
            -- N-263: 統括も同じ1文で確かめる。アカウントが一致すれば統括も
            -- 一致するのが筋だが、移行前の行や手直しでズレた行を置換先に
            -- しないよう、ここでも閉じておく。
            AND COALESCE(replacement.tenant_id, ?) = COALESCE(source.tenant_id, ?)
            -- N-261: 種類の一致も同じ1文で確かめる。事前検査とCASの間で
            -- 置換先が別種へ編集されても、ここで0件に倒れて移らない。
            AND replacement.event_type = source.event_type
            AND replacement.measure_method = source.measure_method
            AND replacement.target_url IS source.target_url
        )`)
      .bind(now, now, input.id, input.expectedVersion, input.replacementId, input.replacementExpectedVersion,
        DEFAULT_TENANT_ID, DEFAULT_TENANT_ID),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'replace', ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, input.replacementId, affectedUsages, input.reason ?? null, input.staffId, now),
    db.prepare(`DELETE FROM conversion_definition_usages AS source
      WHERE source.conversion_point_id = ? AND EXISTS (
        SELECT 1 FROM conversion_definition_usages target
        WHERE target.conversion_point_id = ? AND target.line_account_id = source.line_account_id
          AND target.ref_kind = source.ref_kind AND target.ref_id = source.ref_id
          AND COALESCE(target.ref_version_id, '') = COALESCE(source.ref_version_id, '')
      ) AND EXISTS (SELECT 1 FROM conversion_definition_operations WHERE id = ?)`)
      .bind(input.id, input.replacementId, operationId),
    db.prepare(`UPDATE conversion_definition_usages SET conversion_point_id = ?,
      definition_version = ?, updated_at = ? WHERE conversion_point_id = ?
      AND EXISTS (SELECT 1 FROM conversion_definition_operations WHERE id = ?)`)
      .bind(input.replacementId, input.replacementExpectedVersion, now, input.id, operationId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    // 敗者には、旧地点と置換先のどちらを読み直すのかを分けて伝える。
    const latestReplacement = await currentDefinitionForMutation(db, input.replacementId, input.scope);
    if (!latestReplacement) {
      throw new ConversionDefinitionError('replacement_not_found', '置換先の成果地点が見つかりません。読み直してください', 409);
    }
    if (Number(latestReplacement.version) !== input.replacementExpectedVersion
      || latestReplacement.status !== 'active') {
      throw new ConversionDefinitionError('replacement_conflict', '置換先の成果地点が更新されています。読み直してください', 409);
    }
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return {
    id: input.id,
    replacementId: input.replacementId,
    replacedUsageCount: affectedUsages,
    status: 'stopped' as const,
    version: input.expectedVersion + 1,
  };
}

export async function deleteUnusedConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const impact = await getConversionDefinitionDeleteImpact(db, input.id, input.scope);
  if (!impact?.canDelete) {
    throw new ConversionDefinitionError('definition_in_use', '成果または利用先があるため、削除せず停止してください', 409);
  }
  const now = jstNow();
  const operationId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`DELETE FROM conversion_points
      WHERE id = ? AND version = ?
        AND NOT EXISTS (SELECT 1 FROM conversion_events WHERE conversion_point_id = ?)
        AND NOT EXISTS (SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = ?)`)
      .bind(input.id, input.expectedVersion, input.id, input.id),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'delete', NULL, 0, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, deleted: true as const };
}

/**
 * N-268: 下書きを計測中へ。設定は変えずに status だけ進める。
 * 版は他操作と同じく +1 して、同時操作の競合を版の一致で検出する。
 */
export async function publishConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  if (!current) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(current.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (current.status !== 'draft') {
    throw new ConversionDefinitionError('not_draft', '下書きではありません', 409);
  }
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET status = 'active', updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'draft'`)
    .bind(now, input.id, input.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'active' as const, version: input.expectedVersion + 1 };
}
