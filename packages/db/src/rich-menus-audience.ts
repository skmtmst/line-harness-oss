import { jstNow } from './utils.js';
import { type RichMenuAreaTapTarget, type RichMenuAreaIntent, type RecordRichMenuAssignmentInput, type RichMenuGroup, type RichMenuAudienceStat, type RichMenuTapStats, type RichMenuAreaTapCount } from './rich-menus-types.js';
import { parseRichMenuTagIds, getRichMenuGroups } from './rich-menus-area-writes.js';


export async function getRichMenuAreaTapTarget(
  db: D1Database,
  areaId: string,
): Promise<RichMenuAreaTapTarget | null> {
  const row = await db
    .prepare(
      `SELECT a.id            AS area_id,
              a.page_id       AS page_id,
              a.intent        AS intent,
              a.label         AS label,
              a.tag_ids       AS tag_ids,
              a.score_change  AS score_change,
              a.template_id   AS template_id,
              a.form_id       AS form_id,
              a.action_data   AS action_data,
              p.group_id      AS group_id,
              g.account_id    AS account_id
         FROM rich_menu_areas a
         JOIN rich_menu_pages p  ON p.id = a.page_id
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE a.id = ?`,
    )
    .bind(areaId)
    .first<{
      area_id: string;
      page_id: string;
      intent: RichMenuAreaIntent | null;
      label: string | null;
      tag_ids: string | null;
      score_change: number | null;
      template_id: string | null;
      form_id: string | null;
      action_data: string;
      group_id: string;
      account_id: string;
    }>();
  if (!row) return null;
  let scenarioId: string | null = null;
  try {
    const data = JSON.parse(row.action_data) as Record<string, unknown>;
    if (typeof data.scenarioId === 'string' && data.scenarioId) scenarioId = data.scenarioId;
  } catch { /* Invalid legacy action data has no executable scenario. */ }
  return {
    areaId: row.area_id,
    pageId: row.page_id,
    groupId: row.group_id,
    accountId: row.account_id,
    intent: row.intent,
    label: row.label,
    tagIds: parseRichMenuTagIds(row.tag_ids),
    scoreChange: row.score_change,
    templateId: row.template_id,
    formId: row.form_id,
    scenarioId,
  };
}

// =============================================================================
// 押された回数（148）
// =============================================================================

export async function recordRichMenuAreaTap(
  db: D1Database,
  input: {
    areaId: string;
    pageId: string;
    groupId: string;
    areaLabel?: string | null;
    friendId?: string | null;
    lineAccountId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rich_menu_area_taps
         (id, area_id, page_id, group_id, area_label, friend_id, line_account_id, tapped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.areaId,
      input.pageId,
      input.groupId,
      input.areaLabel ?? null,
      input.friendId ?? null,
      input.lineAccountId ?? null,
      jstNow(),
    )
    .run();
}

/**
 * LINE の link / unlink が成功した後に呼び、現在値と成功履歴を同じ batch で記録する。
 * 管理画面外の rich menu が指定された場合は、以前の管理対象割当だけを現在値から
 * 外す。外部メニューを管理中の group へ推測で結び付けない。
 */
export async function recordRichMenuAssignment(
  db: D1Database,
  input: RecordRichMenuAssignmentInput,
): Promise<void> {
  const target = input.lineRichMenuId
    ? await db
      .prepare(
        `SELECT g.id AS group_id
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE g.account_id = ? AND p.line_richmenu_id = ?
          LIMIT 1`,
      )
      .bind(input.lineAccountId, input.lineRichMenuId)
      .first<{ group_id: string }>()
    : null;
  const previous = await db
    .prepare(
      `SELECT id FROM rich_menu_assignments
        WHERE line_account_id = ? AND friend_id = ?`,
    )
    .bind(input.lineAccountId, input.friendId)
    .first<{ id: string }>();
  const now = input.assignedAt ?? jstNow();
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const run = db
    .prepare(
      `INSERT INTO rich_menu_assignment_runs
         (id, version_id, friend_id, line_account_id, group_id, source_event_id,
          idempotency_key, previous_assignment_id, operation, status, attempt_count,
          next_retry_at, last_error_code, started_at, completed_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 1, NULL, NULL, ?, ?)
       ON CONFLICT(line_account_id, idempotency_key) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.friendId,
      input.lineAccountId,
      target?.group_id ?? null,
      input.reasonEventId ?? null,
      idempotencyKey,
      previous?.id ?? null,
      input.lineRichMenuId ? 'link' : 'unlink',
      now,
      now,
    );

  const current = target && input.lineRichMenuId
    ? db
      .prepare(
        `INSERT INTO rich_menu_assignments
           (id, friend_id, line_account_id, group_id, version_id, line_richmenu_id,
            reason_kind, reason_event_id, assigned_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT(line_account_id, friend_id) DO UPDATE SET
           group_id = excluded.group_id,
           version_id = excluded.version_id,
           line_richmenu_id = excluded.line_richmenu_id,
           reason_kind = excluded.reason_kind,
           reason_event_id = excluded.reason_event_id,
           assigned_at = excluded.assigned_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        previous?.id ?? crypto.randomUUID(),
        input.friendId,
        input.lineAccountId,
        target.group_id,
        input.lineRichMenuId,
        input.reasonKind,
        input.reasonEventId ?? null,
        now,
        now,
      )
    : db
      .prepare(
        `DELETE FROM rich_menu_assignments
          WHERE line_account_id = ? AND friend_id = ?`,
      )
      .bind(input.lineAccountId, input.friendId);

  await db.batch([run, current]);
}

/** 成功した bulk link の1チャンクを、LINE user id からまとめて台帳へ反映する。 */
export async function recordRichMenuAssignmentsByLineUserIds(
  db: D1Database,
  input: {
    lineAccountId: string;
    groupId: string;
    lineRichMenuId: string;
    lineUserIds: string[];
    reasonKind: string;
    reasonEventId?: string | null;
    idempotencyPrefix?: string;
    assignedAt?: string;
  },
): Promise<void> {
  if (input.lineUserIds.length === 0) return;
  const now = input.assignedAt ?? jstNow();
  const prefix = input.idempotencyPrefix ?? crypto.randomUUID();
  const userIdsJson = JSON.stringify(input.lineUserIds);
  const run = db
    .prepare(
      `INSERT INTO rich_menu_assignment_runs
         (id, version_id, friend_id, line_account_id, group_id, source_event_id,
          idempotency_key, previous_assignment_id, operation, status, attempt_count,
          next_retry_at, last_error_code, started_at, completed_at)
       SELECT lower(hex(randomblob(16))), NULL, f.id, ?, ?, ?,
              ? || ':' || f.id, current.id, 'link', 'succeeded', 1,
              NULL, NULL, ?, ?
         FROM friends f
         JOIN json_each(?) requested ON requested.value = f.line_user_id
         LEFT JOIN rich_menu_assignments current
           ON current.line_account_id = ? AND current.friend_id = f.id
        WHERE f.line_account_id = ?
       ON CONFLICT(line_account_id, idempotency_key) DO NOTHING`,
    )
    .bind(
      input.lineAccountId,
      input.groupId,
      input.reasonEventId ?? null,
      prefix,
      now,
      now,
      userIdsJson,
      input.lineAccountId,
      input.lineAccountId,
    );
  const current = db
    .prepare(
      `INSERT INTO rich_menu_assignments
         (id, friend_id, line_account_id, group_id, version_id, line_richmenu_id,
          reason_kind, reason_event_id, assigned_at, updated_at)
       SELECT COALESCE(existing.id, lower(hex(randomblob(16)))), f.id, ?, ?, NULL, ?, ?, ?, ?, ?
         FROM friends f
         JOIN json_each(?) requested ON requested.value = f.line_user_id
         LEFT JOIN rich_menu_assignments existing
           ON existing.line_account_id = ? AND existing.friend_id = f.id
        WHERE f.line_account_id = ?
       ON CONFLICT(line_account_id, friend_id) DO UPDATE SET
         group_id = excluded.group_id,
         version_id = excluded.version_id,
         line_richmenu_id = excluded.line_richmenu_id,
         reason_kind = excluded.reason_kind,
         reason_event_id = excluded.reason_event_id,
         assigned_at = excluded.assigned_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.lineAccountId,
      input.groupId,
      input.lineRichMenuId,
      input.reasonKind,
      input.reasonEventId ?? null,
      now,
      now,
      userIdsJson,
      input.lineAccountId,
      input.lineAccountId,
    );
  await db.batch([run, current]);
}

/** LINE 側から group を取り下げた後、表示中ではなくなった現在値を残さない。 */
export async function clearRichMenuAssignmentsForGroup(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM rich_menu_assignments WHERE group_id = ?`)
    .bind(groupId)
    .run();
}

/** 一覧用に、現在表示中の既知人数と今月の割当ユニーク人数をまとめて返す。 */
export async function getRichMenuAudienceStats(
  db: D1Database,
  accountId: string,
  from: string,
  to: string,
  knownGroups?: RichMenuGroup[],
): Promise<RichMenuAudienceStat[]> {
  const [groups, rows, currentRows, followerRow] = await Promise.all([
    knownGroups ?? getRichMenuGroups(db, accountId),
    db
      .prepare(
        `SELECT group_id, COUNT(DISTINCT friend_id) AS unique_audience
           FROM rich_menu_assignment_runs
          WHERE line_account_id = ?
            AND operation = 'link'
            AND status = 'succeeded'
            AND completed_at >= ? AND completed_at < ?
            AND group_id IS NOT NULL
          GROUP BY group_id`,
      )
      .bind(accountId, from, to)
      .all<{ group_id: string; unique_audience: number }>(),
    db
      .prepare(
        `SELECT current.group_id AS group_id, COUNT(*) AS current_audience
           FROM rich_menu_assignments current
           JOIN friends f ON f.id = current.friend_id
          WHERE current.line_account_id = ? AND f.is_following = 1
          GROUP BY current.group_id`,
      )
      .bind(accountId)
      .all<{ group_id: string; current_audience: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM friends
          WHERE line_account_id = ? AND is_following = 1`,
      )
      .bind(accountId)
      .first<{ count: number }>(),
  ]);
  const monthlyByGroup = new Map(
    (rows.results ?? []).map((row) => [row.group_id, Number(row.unique_audience)]),
  );
  const currentByGroup = new Map(
    (currentRows.results ?? []).map((row) => [row.group_id, Number(row.current_audience)]),
  );
  const explicitAudience = [...currentByGroup.values()].reduce((sum, value) => sum + value, 0);
  const followingAudience = Number(followerRow?.count ?? 0);
  return groups.map((group) => {
    const explicitForGroup = currentByGroup.get(group.id) ?? 0;
    return {
      groupId: group.id,
      currentAudience: group.is_default_for_all === 1
        ? Math.max(0, followingAudience - explicitAudience + explicitForGroup)
        : explicitForGroup,
      monthlyUniqueAudience: monthlyByGroup.get(group.id) ?? 0,
    };
  });
}

/**
 * 期間内に押された回数を、ボタン別・メニュー別に数える。
 *
 * 数え方が2つある。
 *   1. postback で届くボタン（メッセージ・テンプレート・切り替えなど）
 *      → rich_menu_area_taps を数える
 *   2. URLを開くボタンで計測リンクを選んでいる場合
 *      → link_clicks を数える。LINE の外へ出るので webhook には届かない
 *
 * 「URLを開く」で計測リンクを選んでいないボタンは数えられない。押された事実が
 * どこにも届かないため。画面ではそのことを明示する。
 *
 * 注意: 同じ計測リンクを一斉配信など他の場所でも使っていると、そちらのクリックも
 * この数に入る。計測リンクは「リンク単位」で数える仕組みなので、リッチメニュー
 * 経由だけを切り出せない。ボタンごとに専用の計測リンクを作れば分けられる。
 *
 * from / to は日本時間の ISO 文字列。to は含まない（>= from, < to）。
 */
export async function getRichMenuTapStats(
  db: D1Database,
  accountId: string,
  from: string,
  to: string,
): Promise<RichMenuTapStats> {
  const direct = (
    await db
      .prepare(
        `SELECT t.area_id AS area_id,
                t.group_id AS group_id,
                t.page_id  AS page_id,
                MAX(t.area_label) AS label,
                COUNT(*) AS taps
           FROM rich_menu_area_taps t
           JOIN rich_menu_groups g ON g.id = t.group_id
          WHERE g.account_id = ? AND t.tapped_at >= ? AND t.tapped_at < ?
          GROUP BY t.area_id, t.group_id, t.page_id`,
      )
      .bind(accountId, from, to)
      .all<{
        area_id: string;
        group_id: string;
        page_id: string;
        label: string | null;
        taps: number;
      }>()
  ).results ?? [];

  const viaLink = (
    await db
      .prepare(
        `SELECT a.id       AS area_id,
                p.group_id AS group_id,
                a.page_id  AS page_id,
                a.label    AS label,
                COUNT(c.id) AS taps
           FROM rich_menu_areas a
           JOIN rich_menu_pages  p ON p.id = a.page_id
           JOIN rich_menu_groups g ON g.id = p.group_id
           JOIN link_clicks      c ON c.tracked_link_id = a.tracked_link_id
          WHERE g.account_id = ?
            AND a.tracked_link_id IS NOT NULL
            AND c.clicked_at >= ? AND c.clicked_at < ?
          GROUP BY a.id`,
      )
      .bind(accountId, from, to)
      .all<{
        area_id: string;
        group_id: string;
        page_id: string;
        label: string | null;
        taps: number;
      }>()
  ).results ?? [];

  // 今あるボタンの名前を優先する。記録時の名前は、消されたボタン用の控え。
  const currentLabels = new Map(
    (
      (
        await db
          .prepare(
            `SELECT a.id AS id, a.label AS label
               FROM rich_menu_areas a
               JOIN rich_menu_pages  p ON p.id = a.page_id
               JOIN rich_menu_groups g ON g.id = p.group_id
              WHERE g.account_id = ?`,
          )
          .bind(accountId)
          .all<{ id: string; label: string | null }>()
      ).results ?? []
    ).map((r) => [r.id, r.label]),
  );

  const merged = new Map<string, RichMenuAreaTapCount>();
  const add = (
    row: { area_id: string; group_id: string; page_id: string; label: string | null; taps: number },
    viaLinkCount: number,
  ) => {
    const existing = merged.get(row.area_id);
    if (existing) {
      existing.taps += row.taps;
      existing.viaTrackedLink += viaLinkCount;
      return;
    }
    merged.set(row.area_id, {
      areaId: row.area_id,
      groupId: row.group_id,
      pageId: row.page_id,
      label: currentLabels.get(row.area_id) ?? row.label,
      taps: row.taps,
      viaTrackedLink: viaLinkCount,
    });
  };
  for (const row of direct) add(row, 0);
  for (const row of viaLink) add(row, row.taps);

  const byArea = [...merged.values()].sort((a, b) => b.taps - a.taps);

  const groupTotals = new Map<string, number>();
  for (const a of byArea) {
    groupTotals.set(a.groupId, (groupTotals.get(a.groupId) ?? 0) + a.taps);
  }

  return {
    from,
    to,
    byArea,
    byGroup: [...groupTotals.entries()]
      .map(([groupId, taps]) => ({ groupId, taps }))
      .sort((a, b) => b.taps - a.taps),
    total: byArea.reduce((sum, a) => sum + a.taps, 0),
  };
}
