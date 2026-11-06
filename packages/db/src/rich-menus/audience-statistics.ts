import { type RichMenuGroup, type RichMenuAudienceStat, type RichMenuTapStats, type RichMenuAreaTapCount } from './types.js';
import { getRichMenuGroups } from './area-writes.js';


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
