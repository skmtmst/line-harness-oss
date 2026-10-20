import { COMMON_ACTION_MAX_BRANCH_DEPTH, COMMON_ACTION_MAX_DEPTH, COMMON_ACTION_MAX_STEPS, type ActionDefinition } from '../features/automations/automation-engine/index.js';
import { requireResource, requiredString, isRecord, CommonActionValidationError, resolveLatestPublishedReference, assertNoCycle, parseStoredActions, type CommonActionSummary, type CommonActionResources } from './common-actions-is-record.js';

export async function pinAndValidateReferences(
  db: D1Database,
  lineAccountId: string,
  ownerId: string,
  actions: ActionDefinition[],
  options?: { keepPins?: boolean },
): Promise<ActionDefinition[]> {
  const pinned: ActionDefinition[] = [];
  for (const [index, action] of actions.entries()) {
    const field = `actions.${index}.params`;
    const params = { ...action.params };
    if (action.type === 'add_tag' || action.type === 'remove_tag') {
      params.tagId = await requireResource(db, {
        table: 'tags', id: params.tagId, lineAccountId, field: `${field}.tagId`, label: 'タグ',
      });
    } else if (action.type === 'start_scenario' || action.type === 'stop_scenario' || action.type === 'resume_scenario') {
      params.scenarioId = await requireResource(db, {
        table: 'scenarios', id: params.scenarioId, lineAccountId, field: `${field}.scenarioId`, label: 'シナリオ',
      });
    } else if (action.type === 'send_webhook') {
      params.webhookId = await requireResource(db, {
        table: 'outgoing_webhooks', id: params.webhookId, lineAccountId, field: `${field}.webhookId`, label: '送信Webhook',
      });
    } else if (action.type === 'send_message') {
      const templateId = params.templateId ?? params.template_id;
      if (templateId !== undefined) {
        params.templateId = await requireResource(db, {
          table: 'templates', id: templateId, lineAccountId, field: `${field}.templateId`, label: 'テンプレート',
        });
        delete params.template_id;
      } else {
        requiredString(params.content, `${field}.content`, '送信内容');
      }
    } else if (action.type === 'set_metadata') {
      const values = params.values ?? params.data;
      if (!isRecord(values) || Object.keys(values).length === 0) {
        throw new CommonActionValidationError('metadata_values_required', '設定する友だち情報を入力してください', `${field}.values`);
      }
      if (Object.keys(values).some((key) => !key.trim())) {
        throw new CommonActionValidationError('metadata_key_required', '友だち情報の項目名を入力してください', `${field}.values`);
      }
      params.values = values;
      delete params.data;
    } else if (action.type === 'switch_rich_menu') {
      const richMenuId = requiredString(
        params.richMenuPageId ?? params.richMenuId,
        `${field}.richMenuPageId`,
        'リッチメニュー',
      );
      const page = await db.prepare(
        `SELECT p.id
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE (p.id = ? OR p.line_richmenu_id = ?)
            AND g.account_id = ? AND g.status = 'published'
            AND p.line_richmenu_id IS NOT NULL
          LIMIT 1`,
      ).bind(richMenuId, richMenuId, lineAccountId).first<{ id: string }>();
      if (!page) {
        throw new CommonActionValidationError(
          'resource_not_found',
          '公開済みのリッチメニューが見つからないか、別のLINE公式アカウントにあります',
          `${field}.richMenuPageId`,
        );
      }
      params.richMenuPageId = page.id;
      delete params.richMenuId;
    } else if (action.type === 'wait') {
      const minutes = Number(params.durationMinutes ?? params.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes % 5 !== 0 || minutes > 365 * 24 * 60) {
        throw new CommonActionValidationError('wait_minutes_invalid', '待つ時間は5分単位で1年以上にならないよう指定してください', `${field}.minutes`);
      }
      params.durationMinutes = minutes;
      delete params.minutes;
    } else if (action.type === 'common_action') {
      const commonActionId = requiredString(params.commonActionId, `${field}.commonActionId`, '呼び出す共通アクション');
      if (commonActionId === ownerId) {
        throw new CommonActionValidationError('common_action_cycle', '共通アクションは自分自身を呼び出せません', `${field}.commonActionId`);
      }
      /*
       * 監査 R479: 公開時は保存時に確認した版を保持し、最新へ自動で置き換えない。
       * 保存時は最新へ固定する（編集画面の表示と保存値を一致させる）。
       */
      const pinnedId = typeof params.commonActionVersionId === 'string' && params.commonActionVersionId.trim()
        ? params.commonActionVersionId.trim()
        : null;
      if (options?.keepPins && pinnedId) {
        const kept = await db.prepare(
          `SELECT cav.id AS version_id
             FROM common_action_versions cav
             JOIN common_actions ca ON ca.id = cav.common_action_id
            WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
              AND ca.line_account_id = ?`,
        ).bind(pinnedId, commonActionId, lineAccountId).first<{ version_id: string }>();
        if (kept) {
          params.commonActionId = commonActionId;
          params.commonActionVersionId = kept.version_id;
        } else {
          const fallback = await resolveLatestPublishedReference(db, lineAccountId, commonActionId, field);
          params.commonActionId = fallback.id;
          params.commonActionVersionId = fallback.version_id;
        }
      } else {
        const referenced = await resolveLatestPublishedReference(db, lineAccountId, commonActionId, field);
        params.commonActionId = referenced.id;
        params.commonActionVersionId = referenced.version_id;
      }
    } else if (action.type === 'branch') {
      const condition = params.condition as { rules?: Array<{ type?: unknown; value?: unknown }> };
      for (const [ruleIndex, rule] of (condition.rules ?? []).entries()) {
        if (rule.type === 'tag_exists' || rule.type === 'tag_not_exists') {
          await requireResource(db, {
            table: 'tags', id: rule.value, lineAccountId,
            field: `${field}.condition.rules.${ruleIndex}.value`, label: '分岐条件のタグ',
          });
        }
      }
      params.then = await pinAndValidateReferences(
        db, lineAccountId, ownerId, params.then as ActionDefinition[],
      );
      params.else = await pinAndValidateReferences(
        db, lineAccountId, ownerId, params.else as ActionDefinition[],
      );
    }
    pinned.push({ ...action, params });
  }
  await assertNoCycle(db, lineAccountId, ownerId, pinned);
  return pinned;
}

/*
 * 監査 R478: 公開前に参照先の固定版まで展開し、実行計画と同じ制限を検査する。
 * 公開だけ通って開始時に失敗する内容を、理由と対象経路を示して止める。
 * 制限値は automation-engine の buildExecutionPlan と同じ定数を使う。
 * - 共通アクションの呼び出し: 20段まで（利用先から1段使う前提で深さ1から数える）
 * - 条件分岐の入れ子: 3段まで
 * - 展開後の処理総数: 1000個まで（呼び出し自体も1個に数える。
 *   利用側の呼び出し1件分を先に数え、実行時に1件足りなくなる公開を止める）
 */

export async function resolvePublishedVersionActions(
  db: D1Database,
  lineAccountId: string,
  actionId: string,
  pinnedVersionId: unknown,
): Promise<{ versionId: string; actions: ActionDefinition[] } | null> {
  if (typeof pinnedVersionId === 'string' && pinnedVersionId.trim()) {
    const pinned = await db.prepare(
      `SELECT cav.id, cav.action_config
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
          AND ca.line_account_id = ?`,
    ).bind(pinnedVersionId, actionId, lineAccountId).first<{ id: string; action_config: string }>();
    if (pinned) return { versionId: pinned.id, actions: parseStoredActions(pinned.action_config) };
  }
  const current = await db.prepare(
    `SELECT cav.id, cav.action_config
       FROM common_actions ca
       JOIN common_action_versions cav
         ON cav.id = ca.current_published_version_id AND cav.common_action_id = ca.id
        AND cav.status = 'published'
      WHERE ca.id = ? AND ca.line_account_id = ? AND ca.status = 'published'`,
  ).bind(actionId, lineAccountId).first<{ id: string; action_config: string }>();
  if (!current) return null;
  return { versionId: current.id, actions: parseStoredActions(current.action_config) };
}

export async function walkExpansion(
  db: D1Database,
  lineAccountId: string,
  actions: ActionDefinition[],
  context: { depth: number; branchDepth: number; chain: string[]; ids: string[]; state: { count: number } },
): Promise<void> {
  if (context.depth > COMMON_ACTION_MAX_DEPTH) {
    throw new CommonActionValidationError(
      'common_action_too_deep',
      `共通アクションの呼び出しが深すぎます（${COMMON_ACTION_MAX_DEPTH}段まで）。経路：${context.chain.join('→')}`,
      'actions',
    );
  }
  for (const action of actions) {
    context.state.count += 1;
    if (context.state.count > COMMON_ACTION_MAX_STEPS) {
      throw new CommonActionValidationError(
        'execution_plan_too_large',
        `実行する処理が多すぎます（${COMMON_ACTION_MAX_STEPS}個まで）。経路：${context.chain.join('→')}`,
        'actions',
      );
    }
    if (action.type === 'branch') {
      if (context.branchDepth >= COMMON_ACTION_MAX_BRANCH_DEPTH) {
        throw new CommonActionValidationError(
          'branch_too_deep',
          `条件分岐の入れ子は${COMMON_ACTION_MAX_BRANCH_DEPTH}段までです。経路：${context.chain.join('→')}`,
          'actions',
        );
      }
      const params = action.params as { then?: unknown; else?: unknown };
      const thenActions = Array.isArray(params.then) ? params.then as ActionDefinition[] : [];
      const elseActions = Array.isArray(params.else) ? params.else as ActionDefinition[] : [];
      await walkExpansion(db, lineAccountId, thenActions, { ...context, branchDepth: context.branchDepth + 1 });
      await walkExpansion(db, lineAccountId, elseActions, { ...context, branchDepth: context.branchDepth + 1 });
      continue;
    }
    if (action.type !== 'common_action') continue;
    const actionId = action.params.commonActionId;
    if (typeof actionId !== 'string' || !actionId.trim()) continue;
    if (context.ids.includes(actionId)) {
      throw new CommonActionValidationError(
        'common_action_cycle', '共通アクションの呼び出しを循環させることはできません', 'actions',
      );
    }
    const resolved = await resolvePublishedVersionActions(
      db, lineAccountId, actionId, action.params.commonActionVersionId,
    );
    // 公開できる参照先があることは pin で保証済み。無いものは飛ばす。
    if (!resolved) continue;
    const nameRow = await db.prepare(
      `SELECT name FROM common_actions WHERE id = ? AND line_account_id = ?`,
    ).bind(actionId, lineAccountId).first<{ name: string }>();
    context.chain.push(nameRow?.name ?? actionId);
    context.ids.push(actionId);
    await walkExpansion(db, lineAccountId, resolved.actions, {
      ...context,
      depth: context.depth + 1,
      chain: context.chain,
      ids: context.ids,
    });
    context.chain.pop();
    context.ids.pop();
  }
}

export async function assertPublishableExpansion(
  db: D1Database,
  lineAccountId: string,
  actions: ActionDefinition[],
): Promise<void> {
  /*
   * 監査 R478: 実行時は利用側の呼び出し1件が先に1件数えられる。
   * 公開検査でも同じ1件を先に数え、1000件ちょうどの公開が
   * 実行時に1001件で失敗しないようにする（深さの1段予約と同じ考え）。
   */
  const state = { count: 1 };
  await walkExpansion(db, lineAccountId, actions, {
    depth: 1,
    branchDepth: 0,
    chain: [],
    ids: [],
    state,
  });
}

/*
 * 監査 R125: 実行回数・失敗数・最終実行を行ごとの相関副問合せ3本で取ると、
 * 実行履歴の増加に応じて一覧と集計の両方が遅くなっていた。アカウント内の
 * 実行台帳を1回だけ走査してアクション単位に集計し、一覧側は結合で受ける。
 * 一覧と集計で同じ式を共有し、内訳がずれないようにする。
 *   execution_count_this_month: 今月始めた本番の実行数（1人テストを含まない）
 *   failure_count_this_month:   今月のうち、その目印の下の手順が失敗した実行数
 *   last_run_at:                全期間の最終実行
 */
export const COMMON_ACTION_RUN_METRICS_SQL = `
       SELECT metric_version.common_action_id AS action_id,
              COUNT(DISTINCT CASE
                WHEN strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now') THEN r.id END
              ) AS execution_count_this_month,
              COUNT(DISTINCT CASE
                WHEN strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now')
                 AND failed_step.id IS NOT NULL THEN r.id END
              ) AS failure_count_this_month,
              MAX(r.created_at) AS last_run_at
         FROM automation_run_steps marker
         JOIN automation_runs r ON r.id = marker.automation_run_id
         JOIN common_action_versions metric_version
           ON metric_version.id = marker.common_action_version_id
         LEFT JOIN automation_run_steps failed_step
           ON failed_step.automation_run_id = r.id
          AND failed_step.status = 'failed'
          AND substr(failed_step.step_key, 1, length(marker.step_key) + 1)
              = marker.step_key || '/'
        WHERE marker.action_type = 'common_action_marker'
          AND r.is_test = 0
          AND r.line_account_id = ?
        GROUP BY metric_version.common_action_id`;

export async function listCommonActions(
  db: D1Database,
  input: { lineAccountId: string; status?: string; query?: string; folderId?: string; limit?: number; offset?: number },
): Promise<{ items: CommonActionSummary[]; total: number }> {
  const where = [`ca.line_account_id = ?`];
  const binds: unknown[] = [input.lineAccountId];
  if (input.status && input.status !== 'all') {
    if (!['draft', 'published', 'archived', 'old_version', 'unused'].includes(input.status)) {
      throw new CommonActionValidationError('status_invalid', '絞り込み条件が正しくありません', 'status');
    }
    if (input.status === 'old_version') {
      where.push(`EXISTS (SELECT 1 FROM common_action_bindings ob WHERE ob.common_action_id = ca.id AND ob.common_action_version_id <> ca.current_published_version_id)`);
    } else if (input.status === 'unused') {
      // 監査 R480: 保管済みは「保管」タブで見る。「呼ばれていない」には出さない。
      where.push(`ca.status <> 'archived'`);
      where.push(`NOT EXISTS (SELECT 1 FROM common_action_bindings ub WHERE ub.common_action_id = ca.id)`);
    } else {
      where.push(`ca.status = ?`);
      binds.push(input.status);
    }
  } else {
    // 監査 R480: 通常一覧（すべて）から保管済みを外す。保管タブで見る。
    where.push(`ca.status <> 'archived'`);
  }
  if (input.folderId === '__unfiled__') where.push('ca.folder_id IS NULL');
  else if (input.folderId) { where.push('ca.folder_id = ?'); binds.push(input.folderId); }
  if (input.query?.trim()) {
    /*
     * 監査 R124: 画面は「アクション名・中の処理で探す」と案内しているので、
     * 名前と説明だけでなく各版の処理内容（action_config）も検索対象にする。
     * 版は増えても数件程度なので EXISTS で済ませ、一覧の件数と同じ条件を使う。
     */
    where.push(`(ca.name LIKE ? ESCAPE '\\' OR COALESCE(ca.description, '') LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM common_action_versions cv
                  WHERE cv.common_action_id = ca.id
                    AND cv.action_config LIKE ? ESCAPE '\\'))`);
    const escaped = input.query.trim().replace(/[\\%_]/g, '\\$&');
    binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  const total = await db.prepare(
    `SELECT COUNT(*) AS count FROM common_actions ca WHERE ${where.join(' AND ')}`,
  ).bind(...binds).first<{ count: number }>();
  const paginationSql = input.limit === undefined ? '' : ' LIMIT ? OFFSET ?';
  const paginationBinds = input.limit === undefined ? [] : [input.limit, input.offset ?? 0];
  const rows = await db.prepare(
    `SELECT ca.id, ca.folder_id, ca.name, ca.description, ca.status, ca.updated_at,
            dv.version_number AS draft_version, pv.version_number AS published_version,
            /* 監査 R470: 公開中行は公開版の処理数と版番号をそろえる。
               下書き優先で数えると編集中の数が公開内容に見える。 */
            COALESCE(json_array_length(CASE WHEN ca.status = 'published'
              THEN COALESCE(pv.action_config, '[]')
              ELSE COALESCE(dv.action_config, pv.action_config, '[]') END), 0) AS action_count,
            COUNT(DISTINCT b.id) AS binding_count,
            COUNT(DISTINCT CASE
              WHEN ca.current_published_version_id IS NOT NULL
               AND b.common_action_version_id <> ca.current_published_version_id THEN b.id END) AS old_binding_count
            ,COALESCE(run_metrics.execution_count_this_month, 0) AS execution_count_this_month
            ,COALESCE(run_metrics.failure_count_this_month, 0) AS failure_count_this_month
            ,run_metrics.last_run_at AS last_run_at
       FROM common_actions ca
       LEFT JOIN common_action_versions dv ON dv.id = ca.current_draft_version_id
       LEFT JOIN common_action_versions pv ON pv.id = ca.current_published_version_id
       LEFT JOIN common_action_bindings b ON b.common_action_id = ca.id
       LEFT JOIN (${COMMON_ACTION_RUN_METRICS_SQL}) run_metrics ON run_metrics.action_id = ca.id
      WHERE ${where.join(' AND ')}
      GROUP BY ca.id
      ORDER BY ca.updated_at DESC, ca.id DESC${paginationSql}`,
  ).bind(input.lineAccountId, ...binds, ...paginationBinds).all<{
    id: string; folder_id: string | null; name: string; description: string | null; status: CommonActionSummary['status'];
    updated_at: string; draft_version: number | null; published_version: number | null;
    action_count: number; binding_count: number; old_binding_count: number;
    execution_count_this_month: number; failure_count_this_month: number;
    last_run_at: string | null;
  }>();
  return { items: (rows.results ?? []).map((row) => ({
    id: row.id,
    folderId: row.folder_id ?? null,
    name: row.name,
    description: row.description,
    status: row.status,
    draftVersion: row.draft_version,
    publishedVersion: row.published_version,
    actionCount: Number(row.action_count),
    bindingCount: Number(row.binding_count),
    oldVersionBindingCount: Number(row.old_binding_count),
    executionCountThisMonth: Number(row.execution_count_this_month),
    failureCountThisMonth: Number(row.failure_count_this_month),
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
  })), total: Number(total?.count ?? 0) };
}

/**
 * 一覧の札・KPIに使う集計だけを返す（#554 点検#519中2）。
 *
 * 画面は件数表示のために全件取得をもう1回投げていたが、行単価の高い
 * 月次集計サブクエリ4本が行ごとに走るため、表示1回で2倍走っていた。
 * 集計はページ送り・絞り込みに依らずアカウント全体で数える。
 * 保管済みは通常一覧に出さないため、合計からは外して件数だけ別に数える。
 * 行ごとの内訳式は `listCommonActions` と同じにし、画面の合計と一致させる。
 */
export async function getCommonActionsSummary(
  db: D1Database,
  lineAccountId: string,
): Promise<{
  total: number;
  published: number;
  draft: number;
  oldVersion: number;
  unused: number;
  archived: number;
  actions: number;
  bindings: number;
  outdated: number;
  outdatedItems: number;
  executions: number;
  failures: number;
}> {
  // 監査 R480: 集計は通常一覧と同じ範囲（保管済みを除く）。保管は件数だけ別に数える。
  const archivedRow = await db.prepare(
    `SELECT COUNT(*) AS archived FROM common_actions
      WHERE line_account_id = ? AND status = 'archived'`,
  ).bind(lineAccountId).first<{ archived: number }>();
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
            SUM(CASE WHEN old_binding_count > 0 THEN 1 ELSE 0 END) AS old_version,
            /* 監査 R123: 「呼ばれていない」の件数は一覧の絞り込み（呼び出し元なし）と
               同じ定義に揃える。以前は公開中だけを数えたため、下書き・保管の未使用が
               札の数だけ増えて一覧と合わなかった。 */
            SUM(CASE WHEN binding_count = 0 THEN 1 ELSE 0 END) AS unused,
            SUM(action_count) AS actions,
            SUM(binding_count) AS bindings,
            SUM(old_binding_count) AS outdated,
            SUM(CASE WHEN old_binding_count > 0 THEN 1 ELSE 0 END) AS outdated_items,
            SUM(execution_count_this_month) AS executions,
            SUM(failure_count_this_month) AS failures
       FROM (SELECT ca.status AS status,
                    COALESCE(json_array_length(CASE WHEN ca.status = 'published'
                      THEN COALESCE(pv.action_config, '[]')
                      ELSE COALESCE(dv.action_config, pv.action_config, '[]') END), 0) AS action_count,
                    COUNT(DISTINCT b.id) AS binding_count,
                    COUNT(DISTINCT CASE
                      WHEN ca.current_published_version_id IS NOT NULL
                       AND b.common_action_version_id <> ca.current_published_version_id THEN b.id END) AS old_binding_count
                    ,COALESCE(run_metrics.execution_count_this_month, 0) AS execution_count_this_month
                    ,COALESCE(run_metrics.failure_count_this_month, 0) AS failure_count_this_month
               FROM common_actions ca
               LEFT JOIN common_action_versions dv ON dv.id = ca.current_draft_version_id
               LEFT JOIN common_action_versions pv ON pv.id = ca.current_published_version_id
               LEFT JOIN common_action_bindings b ON b.common_action_id = ca.id
               LEFT JOIN (${COMMON_ACTION_RUN_METRICS_SQL}) run_metrics ON run_metrics.action_id = ca.id
              WHERE ca.line_account_id = ? AND ca.status <> 'archived'
              GROUP BY ca.id)`,
  ).bind(lineAccountId, lineAccountId).first<{
    total: number; published: number | null; draft: number | null; old_version: number | null;
    unused: number | null; actions: number | null; bindings: number | null; outdated: number | null;
    outdated_items: number | null; executions: number | null; failures: number | null;
  }>();
  return {
    total: Number(row?.total ?? 0),
    published: Number(row?.published ?? 0),
    draft: Number(row?.draft ?? 0),
    oldVersion: Number(row?.old_version ?? 0),
    unused: Number(row?.unused ?? 0),
    archived: Number(archivedRow?.archived ?? 0),
    actions: Number(row?.actions ?? 0),
    bindings: Number(row?.bindings ?? 0),
    outdated: Number(row?.outdated ?? 0),
    outdatedItems: Number(row?.outdated_items ?? 0),
    executions: Number(row?.executions ?? 0),
    failures: Number(row?.failures ?? 0),
  };
}

export async function listCommonActionResources(
  db: D1Database,
  input: {
    lineAccountId: string;
    excludeCommonActionId?: string;
    trigger?: 'tag.added';
  },
): Promise<CommonActionResources> {
  const [
    tags,
    scenarios,
    templates,
    supportMarks,
    reminders,
    notificationRules,
    webhooks,
    richMenus,
    commonActionRows,
  ] = await Promise.all([
    db.prepare(
      `SELECT id, name FROM tags WHERE line_account_id = ? ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM scenarios WHERE line_account_id = ? AND is_active = 1 ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM templates
        WHERE line_account_id = ? AND published_version > 0
        ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT sm.id, sm.name
         FROM support_marks sm
         JOIN support_mark_scopes sms ON sms.mark_id = sm.id
         JOIN line_accounts la ON la.id = ? AND la.tenant_id = sms.tenant_id
        WHERE sm.archived_at IS NULL
          AND (sms.line_account_id IS NULL OR sms.line_account_id = ?)
        ORDER BY sm.display_order ASC, sm.name ASC`,
    ).bind(input.lineAccountId, input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM reminders
        WHERE line_account_id = ? AND deleted_at IS NULL
          AND lifecycle_status <> 'stopped'
        ORDER BY display_order ASC, name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM notification_rules
        WHERE line_account_id = ? AND is_active = 1
        ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM outgoing_webhooks
        WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT p.id, g.name || ' / ' || p.name AS name
         FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND g.status = 'published'
          AND p.line_richmenu_id IS NOT NULL
        ORDER BY g.name ASC, p.order_index ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT ca.id, ca.name, cav.version_number AS version,
              ca.current_published_version_id
         FROM common_actions ca
         JOIN common_action_versions cav
           ON cav.id = ca.current_published_version_id AND cav.common_action_id = ca.id
          AND cav.status = 'published'
        WHERE ca.line_account_id = ? AND ca.status = 'published'
          AND (? = '' OR ca.id <> ?)
        ORDER BY ca.name ASC`,
    ).bind(
      input.lineAccountId,
      input.excludeCommonActionId ?? '',
      input.excludeCommonActionId ?? '',
    ).all<{
      id: string;
      name: string;
      version: number;
      current_published_version_id: string;
    }>(),
  ]);
  const objectSchema = (
    required: string[],
    properties: Record<string, Record<string, unknown>>,
  ) => ({ type: 'object' as const, required, properties });
  const commonTiming = {
    delayMinutes: { type: 'integer', minimum: 0, maximum: 525600, multipleOf: 5 },
    cancelIfTagRemoved: { type: 'boolean', default: true },
  };
  const actionTypes: CommonActionResources['actionTypes'] = input.trigger === 'tag.added' ? [
    { id: 'send_text', label: 'テキスト送信', actionType: 'send_message', variant: 'text', state: 'available', reason: null, schema: objectSchema(['content'], { content: { type: 'string', minLength: 1 }, ...commonTiming }) },
    { id: 'send_template', label: 'テンプレート送信', actionType: 'send_message', variant: 'template', resource: 'templates', state: 'available', reason: null, schema: objectSchema(['templateId'], { templateId: { type: 'string' }, ...commonTiming }) },
    { id: 'add_tag', label: 'タグ追加', actionType: 'add_tag', resource: 'tags', state: 'available', reason: null, schema: objectSchema(['tagId'], { tagId: { type: 'string' }, ...commonTiming }) },
    { id: 'remove_tag', label: 'タグ解除', actionType: 'remove_tag', resource: 'tags', state: 'available', reason: null, schema: objectSchema(['tagId'], { tagId: { type: 'string' }, ...commonTiming }) },
    { id: 'set_metadata', label: '友だち情報更新', actionType: 'set_metadata', resource: 'friendFields', state: 'unavailable', reason: 'friend_field_scope_pending', schema: objectSchema(['fieldId', 'value'], { fieldId: { type: 'string' }, value: {}, ...commonTiming }) },
    { id: 'set_support_mark', label: '対応マーク変更', actionType: 'set_support_mark', resource: 'supportMarks', state: 'available', reason: null, schema: objectSchema(['markId'], { markId: { type: 'string' }, ...commonTiming }) },
    { id: 'start_scenario', label: 'シナリオ開始', actionType: 'start_scenario', resource: 'scenarios', state: 'available', reason: null, schema: objectSchema(['scenarioId'], { scenarioId: { type: 'string' }, ...commonTiming }) },
    { id: 'stop_scenario', label: 'シナリオ停止', actionType: 'stop_scenario', resource: 'scenarios', state: 'available', reason: null, schema: objectSchema(['scenarioId'], { scenarioId: { type: 'string' }, ...commonTiming }) },
    { id: 'start_reminder', label: 'リマインダ開始', actionType: 'start_reminder', resource: 'reminders', state: 'available', reason: null, schema: objectSchema(['reminderId'], { reminderId: { type: 'string' }, ...commonTiming }) },
    { id: 'stop_reminder', label: 'リマインダ解除', actionType: 'stop_reminder', resource: 'reminders', state: 'available', reason: null, schema: objectSchema(['reminderId'], { reminderId: { type: 'string' }, ...commonTiming }) },
    { id: 'switch_rich_menu', label: 'リッチメニュー切替', actionType: 'switch_rich_menu', resource: 'richMenus', state: 'available', reason: null, schema: objectSchema(['richMenuPageId'], { richMenuPageId: { type: 'string' }, ...commonTiming }) },
    { id: 'notify_staff', label: '担当者通知', actionType: 'notify_staff', resource: 'notificationRules', state: 'available', reason: null, schema: objectSchema(['notificationRuleId', 'message'], { notificationRuleId: { type: 'string' }, message: { type: 'string', minLength: 1 }, ...commonTiming }) },
    { id: 'grant_mileage', label: 'マイル付与', actionType: 'grant_mileage', state: 'available', reason: null, schema: objectSchema(['amount'], { amount: { type: 'integer', minimum: 1, maximum: 1000000 }, ...commonTiming }) },
  ] : [];
  return {
    trigger: input.trigger ?? null,
    actionTypes,
    tags: tags.results ?? [],
    scenarios: scenarios.results ?? [],
    templates: templates.results ?? [],
    // #318 が項目定義へアカウント範囲を追加するまで、別統括の項目を混ぜない。
    friendFields: [],
    supportMarks: supportMarks.results ?? [],
    reminders: reminders.results ?? [],
    notificationRules: notificationRules.results ?? [],
    webhooks: webhooks.results ?? [],
    richMenus: richMenus.results ?? [],
    commonActions: (commonActionRows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      currentPublishedVersionId: row.current_published_version_id,
    })),
  };
}
