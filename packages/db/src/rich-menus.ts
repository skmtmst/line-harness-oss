import { jstNow } from './utils.js';

// =============================================================================
// Rich Menu Editor — groups / pages / areas
// =============================================================================
//
// 1 group = 1 リッチメニューセット (1 ページ構成も 1 group として扱う)
// 1 page  = タブ 1 枚 = LINE 上の richmenu 1 個
// 1 area  = page 内のタップ可能矩形。LINE 上限 20 個まで
//
// alias は決定論的に lhx-{groupId 先頭 8 文字}-{order_index} で命名。
// richmenuswitch アクションの遷移先は self の page_id を `targetPageId` で持つ。
// publish 時に publisher 側で alias_id へ解決する。

export interface RichMenuGroup {
  id: string;
  account_id: string;
  name: string;
  chat_bar_text: string;
  size: 'large' | 'compact';
  default_page_id: string | null;
  is_default_for_all: number;
  status: 'draft' | 'published';
  publishing_at: string | null;
  /** 出し分けの条件（SegmentCondition の JSON）。未設定なら null。 */
  targeting_condition: string | null;
  /** 複数のメニューに当てはまったときの順番。小さいほうが先。 */
  targeting_priority: number;
  targeting_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface RichMenuPage {
  id: string;
  group_id: string;
  order_index: number;
  name: string;
  alias_id: string;
  line_richmenu_id: string | null;
  image_r2_key: string | null;
  image_content_type: string | null;
  created_at: string;
  updated_at: string;
}

// 運用者から見た「何をするボタンか」。LINE が持てる action は uri / message /
// postback / richmenuswitch の4つだけなので、「電話をかける」「テンプレートを送る」
// 「回答フォームを開く」はその上に乗せた言い換えとして intent で持つ。
// publish 時に rich-menu-publisher が LINE の action へ変換する。
export type RichMenuAreaIntent =
  | 'url'      // URLを開く       → uri
  | 'tel'      // 電話をかける     → uri (tel:)
  | 'text'     // テキストを送る   → message
  | 'template' // テンプレートを送る → postback (こちらから送る)
  | 'form'     // 回答フォームを開く → uri (LIFF)
  | 'switch'   // メニューを切り替える → richmenuswitch
  | 'postback';

export interface RichMenuArea {
  id: string;
  page_id: string;
  bounds_x: number;
  bounds_y: number;
  bounds_width: number;
  bounds_height: number;
  action_type: 'uri' | 'message' | 'postback' | 'richmenuswitch';
  action_data: string; // JSON serialized
  intent: RichMenuAreaIntent | null;
  label: string | null;
  tag_ids: string | null; // JSON serialized string[]
  score_change: number | null;
  template_id: string | null;
  form_id: string | null;
  tracked_link_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RichMenuAreaInput {
  // 保存のたびに新しい id を振ると、押された回数の集計がボタン単位で切れる。
  // 既存 area の id を渡せば、そのまま引き継ぐ (page と同じ流儀)。
  id?: string;
  boundsX: number;
  boundsY: number;
  boundsWidth: number;
  boundsHeight: number;
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
  actionData: Record<string, unknown>;
  intent?: RichMenuAreaIntent | null;
  label?: string | null;
  tagIds?: string[] | null;
  scoreChange?: number | null;
  templateId?: string | null;
  formId?: string | null;
  trackedLinkId?: string | null;
}

export interface RichMenuPageInput {
  // PATCH (replaceRichMenuPages) で **既存 page を保持** したい場合に同じ id を渡す。
  // 新規ページは undefined。この id が rich_menu_pages.id とそのまま一致するので、
  // `richmenuswitch.actionData.targetPageId` を再 PATCH で安定して解決できる。
  // また、保持された page の image_r2_key / line_richmenu_id は失われない。
  id?: string;
  name: string;
  orderIndex: number;
  areas: RichMenuAreaInput[];
}

export interface CreateRichMenuGroupInput {
  accountId: string;
  name: string;
  chatBarText: string;
  size: 'large' | 'compact';
  pages: RichMenuPageInput[];
}

export interface UpdateRichMenuGroupMetaInput {
  name?: string;
  chatBarText?: string;
  isDefaultForAll?: boolean;
  /** null を渡すと条件を消す。 */
  targetingCondition?: string | null;
  targetingPriority?: number;
  targetingEnabled?: boolean;
}

export type RichMenuAreaWithParsed = RichMenuArea & {
  actionData: Record<string, unknown>;
  tagIds: string[];
};

export interface RichMenuPageWithAreas extends RichMenuPage {
  areas: RichMenuAreaWithParsed[];
}

export interface RichMenuGroupWithPages extends RichMenuGroup {
  pages: RichMenuPageWithAreas[];
}

// alias は決定論的命名: 同 group 内で order_index ごとに一意、再 publish も idempotent。
export function buildRichMenuAliasId(groupId: string, orderIndex: number): string {
  return `lhx-${groupId.slice(0, 8)}-${orderIndex}`;
}

// tag_ids は JSON 文字列で持つ。壊れた値が入っていても画面を落とさない。
export function parseRichMenuTagIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

// area の INSERT は作成時と全置換時の2か所から呼ばれる。列が増えるたびに
// 2か所直すのを避けるため、ここに集約する。
function buildAreaInsert(
  db: D1Database,
  areaId: string,
  pageId: string,
  a: RichMenuAreaInput,
  now: string,
): D1PreparedStatement {
  const tagIds = a.tagIds && a.tagIds.length > 0 ? JSON.stringify(a.tagIds) : null;
  return db
    .prepare(
      `INSERT INTO rich_menu_areas
         (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
          action_type, action_data, intent, label, tag_ids, score_change,
          template_id, form_id, tracked_link_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      areaId,
      pageId,
      a.boundsX,
      a.boundsY,
      a.boundsWidth,
      a.boundsHeight,
      a.actionType,
      JSON.stringify(a.actionData),
      a.intent ?? null,
      a.label ?? null,
      tagIds,
      a.scoreChange ?? null,
      a.templateId ?? null,
      a.formId ?? null,
      a.trackedLinkId ?? null,
      now,
      now,
    );
}

export async function getRichMenuGroups(
  db: D1Database,
  accountId: string,
): Promise<RichMenuGroup[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_groups WHERE account_id = ? ORDER BY updated_at DESC`,
    )
    .bind(accountId)
    .all<RichMenuGroup>();
  return result.results ?? [];
}

export async function getRichMenuGroupById(
  db: D1Database,
  id: string,
): Promise<RichMenuGroup | null> {
  return (await db
    .prepare(`SELECT * FROM rich_menu_groups WHERE id = ?`)
    .bind(id)
    .first<RichMenuGroup>()) ?? null;
}

export async function getRichMenuGroupWithPages(
  db: D1Database,
  id: string,
): Promise<RichMenuGroupWithPages | null> {
  const group = await getRichMenuGroupById(db, id);
  if (!group) return null;
  const pagesResult = await db
    .prepare(
      `SELECT * FROM rich_menu_pages WHERE group_id = ? ORDER BY order_index`,
    )
    .bind(id)
    .all<RichMenuPage>();
  const pages = pagesResult.results ?? [];
  if (pages.length === 0) {
    return { ...group, pages: [] };
  }
  const placeholders = pages.map(() => '?').join(',');
  const areasResult = await db
    .prepare(
      `SELECT * FROM rich_menu_areas WHERE page_id IN (${placeholders}) ORDER BY id`,
    )
    .bind(...pages.map((p) => p.id))
    .all<RichMenuArea>();
  const areas = areasResult.results ?? [];
  const areasByPage = new Map<string, RichMenuAreaWithParsed[]>();
  for (const a of areas) {
    const list = areasByPage.get(a.page_id) ?? [];
    list.push({
      ...a,
      actionData: JSON.parse(a.action_data),
      tagIds: parseRichMenuTagIds(a.tag_ids),
    });
    areasByPage.set(a.page_id, list);
  }
  return {
    ...group,
    pages: pages.map((p) => ({ ...p, areas: areasByPage.get(p.id) ?? [] })),
  };
}

export async function createRichMenuGroup(
  db: D1Database,
  input: CreateRichMenuGroupInput,
): Promise<RichMenuGroupWithPages> {
  const groupId = crypto.randomUUID();
  const now = jstNow();

  // pages の順序通りに alias_id を確定。
  // input.id は新規 group 作成時には信用しない (rich_menu_pages.id PK 衝突を防ぐ
  // ため。別 group のページから duplicate されたコピー由来の id 等)。
  // 既存 page を保持する PATCH 時のみ replaceRichMenuPages 側で id 維持する。
  const pageRecords = input.pages.map((p) => ({
    id: crypto.randomUUID(),
    orderIndex: p.orderIndex,
    name: p.name,
    aliasId: buildRichMenuAliasId(groupId, p.orderIndex),
    areas: p.areas,
  }));
  // 1 ページ目を default にしておく (削除されるまで暫定)。
  const defaultPageId = pageRecords[0]?.id ?? null;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO rich_menu_groups
           (id, account_id, name, chat_bar_text, size, default_page_id,
            is_default_for_all, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?)`,
      )
      .bind(
        groupId,
        input.accountId,
        input.name,
        input.chatBarText,
        input.size,
        defaultPageId,
        now,
        now,
      ),
  );
  for (const p of pageRecords) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO rich_menu_pages
             (id, group_id, order_index, name, alias_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(p.id, groupId, p.orderIndex, p.name, p.aliasId, now, now),
    );
    for (const a of p.areas) {
      stmts.push(buildAreaInsert(db, crypto.randomUUID(), p.id, a, now));
    }
  }
  await db.batch(stmts);

  const created = await getRichMenuGroupWithPages(db, groupId);
  if (!created) throw new Error('failed to read back created rich menu group');
  return created;
}

export async function updateRichMenuGroupMeta(
  db: D1Database,
  id: string,
  patch: UpdateRichMenuGroupMetaInput,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.chatBarText !== undefined) {
    sets.push('chat_bar_text = ?');
    vals.push(patch.chatBarText);
  }
  if (patch.isDefaultForAll !== undefined) {
    sets.push('is_default_for_all = ?');
    vals.push(patch.isDefaultForAll ? 1 : 0);
  }
  if (patch.targetingCondition !== undefined) {
    sets.push('targeting_condition = ?');
    vals.push(patch.targetingCondition);
  }
  if (patch.targetingPriority !== undefined) {
    sets.push('targeting_priority = ?');
    vals.push(patch.targetingPriority);
  }
  if (patch.targetingEnabled !== undefined) {
    sets.push('targeting_enabled = ?');
    vals.push(patch.targetingEnabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(jstNow());
  vals.push(id);
  await db
    .prepare(`UPDATE rich_menu_groups SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();
}

// pages 配列を「id 維持型」全置換する。
// - 入力 page.id が既存 rich_menu_pages.id にマッチした場合、そのページの
//   image_r2_key / image_content_type / line_richmenu_id / created_at は引き継ぐ。
//   richmenuswitch.actionData.targetPageId が PATCH を跨いでも安定して解決できる。
// - 入力にない既存 page は削除。新規 page は新 UUID で挿入。
// - 実装: UNIQUE (group_id, order_index) 制約衝突を避けるため、
//   一旦 group の全 page を DELETE → 新構成で INSERT し直す。保持対象のメタは
//   事前に取得しておいて INSERT 時に復元する。
// - areas は常に全置換 (cascade DELETE で消えた後 INSERT)。
export async function replaceRichMenuPages(
  db: D1Database,
  groupId: string,
  pages: RichMenuPageInput[],
): Promise<void> {
  const now = jstNow();

  // 既存 page のメタ (image / line_richmenu_id / created_at) を保持するため事前取得。
  const existing = (
    (
      await db
        .prepare(
          `SELECT id, image_r2_key, image_content_type, line_richmenu_id, created_at
             FROM rich_menu_pages WHERE group_id = ?`,
        )
        .bind(groupId)
        .all<{
          id: string;
          image_r2_key: string | null;
          image_content_type: string | null;
          line_richmenu_id: string | null;
          created_at: string;
        }>()
    ).results ?? []
  );
  const existingMap = new Map(existing.map((p) => [p.id, p]));

  // area の id も引き継ぐ。押された回数はこの id を軸に数えるので、保存のたびに
  // 振り直すと、同じボタンの記録がそこで途切れてしまう。
  // 引き継ぐのは「この group に今ある id」だけ。別 group の id や消えた id を
  // そのまま挿すと PK が衝突する (page 側と同じ考え方)。
  const existingAreaIds = new Set(
    (
      (
        await db
          .prepare(
            `SELECT a.id AS id
               FROM rich_menu_areas a
               JOIN rich_menu_pages p ON p.id = a.page_id
              WHERE p.group_id = ?`,
          )
          .bind(groupId)
          .all<{ id: string }>()
      ).results ?? []
    ).map((r) => r.id),
  );
  const claimedAreaIds = new Set<string>();
  const resolveAreaId = (a: RichMenuAreaInput): string => {
    if (a.id && existingAreaIds.has(a.id) && !claimedAreaIds.has(a.id)) {
      claimedAreaIds.add(a.id);
      return a.id;
    }
    return crypto.randomUUID();
  };

  // 入力を「保持 vs 新規」に振り分けつつメタを復元。
  // 重要: p.id を流用するのは「current group の existingMap に一致した時だけ」。
  // それ以外 (別 group の id / stale id / undefined) は新 UUID を割り当てる。
  // current group 外の id をそのまま INSERT すると rich_menu_pages.id が PK 衝突する。
  //
  // 同じ existing id が input 内に 2 回以上現れた場合 (route 側でも reject されるが
  // 防御として)、最初の出現だけメタを継承し、後続は新規扱いにして PK 衝突を回避する。
  const claimedReusedIds = new Set<string>();
  const newPageRecords = pages.map((p) => {
    let reused = p.id ? existingMap.get(p.id) : undefined;
    if (reused && claimedReusedIds.has(reused.id)) {
      reused = undefined;
    }
    if (reused) claimedReusedIds.add(reused.id);
    return {
      id: reused?.id ?? crypto.randomUUID(),
      orderIndex: p.orderIndex,
      name: p.name,
      aliasId: buildRichMenuAliasId(groupId, p.orderIndex),
      imageR2Key: reused?.image_r2_key ?? null,
      imageContentType: reused?.image_content_type ?? null,
      lineRichMenuId: reused?.line_richmenu_id ?? null,
      createdAt: reused?.created_at ?? now,
      areas: p.areas,
    };
  });

  const stmts: D1PreparedStatement[] = [];
  // UNIQUE 制約衝突を避けるため、いったん DELETE → 復元 INSERT。
  stmts.push(db.prepare(`DELETE FROM rich_menu_pages WHERE group_id = ?`).bind(groupId));

  for (const p of newPageRecords) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO rich_menu_pages
             (id, group_id, order_index, name, alias_id,
              image_r2_key, image_content_type, line_richmenu_id,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          p.id,
          groupId,
          p.orderIndex,
          p.name,
          p.aliasId,
          p.imageR2Key,
          p.imageContentType,
          p.lineRichMenuId,
          p.createdAt,
          now,
        ),
    );
    for (const a of p.areas) {
      stmts.push(buildAreaInsert(db, resolveAreaId(a), p.id, a, now));
    }
  }

  if (newPageRecords.length > 0) {
    const firstPage =
      newPageRecords.find((p) => p.orderIndex === 0) ?? newPageRecords[0];
    stmts.push(
      db
        .prepare(
          `UPDATE rich_menu_groups SET default_page_id = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(firstPage.id, now, groupId),
    );
  }

  await db.batch(stmts);
}

export async function deleteRichMenuGroup(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM rich_menu_groups WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function setRichMenuPageImage(
  db: D1Database,
  pageId: string,
  imageR2Key: string,
  imageContentType: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_pages SET image_r2_key = ?, image_content_type = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(imageR2Key, imageContentType, jstNow(), pageId)
    .run();
}

export async function pageBelongsToGroup(
  db: D1Database,
  groupId: string,
  pageId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS hit FROM rich_menu_pages WHERE id = ? AND group_id = ?`)
    .bind(pageId, groupId)
    .first<{ hit: number }>();
  return !!row;
}

// Publish ロックを取る。既にロックされていれば false (HTTP 409 用)。
export async function acquirePublishLock(
  db: D1Database,
  groupId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_groups
         SET publishing_at = ?
       WHERE id = ? AND publishing_at IS NULL`,
    )
    .bind(jstNow(), groupId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function releasePublishLock(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE rich_menu_groups SET publishing_at = NULL WHERE id = ?`)
    .bind(groupId)
    .run();
}

export async function setPageRichMenuId(
  db: D1Database,
  pageId: string,
  lineRichMenuId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_pages SET line_richmenu_id = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(lineRichMenuId, jstNow(), pageId)
    .run();
}

export async function markRichMenuGroupPublished(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_groups
         SET status = 'published', publishing_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(jstNow(), groupId)
    .run();
}

// Unpublish 完了時の DB 整合: 全 page の line_richmenu_id を null に戻し、
// group.status を 'draft' に戻す。is_default_for_all も 0 に戻す
// (LINE 側で default unlink された前提)。LINE 側で alias / richmenu / default
// の削除が成功した後に呼ばれる想定。
export async function markRichMenuGroupUnpublished(
  db: D1Database,
  groupId: string,
): Promise<void> {
  const now = jstNow();
  await db.batch([
    db
      .prepare(
        `UPDATE rich_menu_pages
            SET line_richmenu_id = NULL, updated_at = ?
          WHERE group_id = ?`,
      )
      .bind(now, groupId),
    db
      .prepare(
        `UPDATE rich_menu_groups
            SET status = 'draft', publishing_at = NULL,
                is_default_for_all = 0, updated_at = ?
          WHERE id = ?`,
      )
      .bind(now, groupId),
  ]);
}

// =============================================================================
// タップされたボタンを引く
// =============================================================================
//
// リッチメニューのボタンを押すと、LINE から postback が飛んでくる。その data に
// 忍ばせた area の id から、「どのボタンが押されたか」と「押されたら何をするか」
// をまとめて引く。webhook から使う。

export interface RichMenuAreaTapTarget {
  areaId: string;
  pageId: string;
  groupId: string;
  accountId: string;
  intent: RichMenuAreaIntent | null;
  label: string | null;
  tagIds: string[];
  scoreChange: number | null;
  templateId: string | null;
  formId: string | null;
}

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
      group_id: string;
      account_id: string;
    }>();
  if (!row) return null;
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

export interface RichMenuAreaTapCount {
  areaId: string;
  groupId: string;
  pageId: string;
  /** ボタン名。消されたボタンは、押された時点の名前が出る。 */
  label: string | null;
  taps: number;
  /** そのうち、計測リンク経由で数えた分。 */
  viaTrackedLink: number;
}

export interface RichMenuTapStats {
  from: string;
  to: string;
  byArea: RichMenuAreaTapCount[];
  byGroup: { groupId: string; taps: number }[];
  total: number;
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

// =============================================================================
// 出し分け（149）
// =============================================================================

export interface RichMenuTargetingCandidate {
  groupId: string;
  name: string;
  priority: number;
  /** SegmentCondition の JSON。 */
  condition: string;
  /** 友だちに出すのは 1 ページ目の richmenu。 */
  lineRichMenuId: string | null;
}

/**
 * 出し分けの候補を、見る順に返す。
 *
 * 条件が入っていて、有効で、LINE に登録済み（1ページ目の richmenu がある）
 * ものだけ。下書きのメニューを出そうとしても LINE 側に実体が無いので、
 * ここで落としておく。
 */
export async function getRichMenuTargetingCandidates(
  db: D1Database,
  accountId: string,
): Promise<RichMenuTargetingCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT g.id                 AS group_id,
              g.name               AS name,
              g.targeting_priority AS priority,
              g.targeting_condition AS condition,
              p.line_richmenu_id   AS line_richmenu_id
         FROM rich_menu_groups g
         JOIN rich_menu_pages  p ON p.group_id = g.id AND p.order_index = 0
        WHERE g.account_id = ?
          AND g.targeting_enabled = 1
          AND g.targeting_condition IS NOT NULL
          AND g.status = 'published'
          AND p.line_richmenu_id IS NOT NULL
        ORDER BY g.targeting_priority ASC, g.created_at ASC`,
    )
    .bind(accountId)
    .all<{
      group_id: string;
      name: string;
      priority: number;
      condition: string;
      line_richmenu_id: string | null;
    }>();
  return (rows.results ?? []).map((r) => ({
    groupId: r.group_id,
    name: r.name,
    priority: r.priority,
    condition: r.condition,
    lineRichMenuId: r.line_richmenu_id,
  }));
}

/** 出し分けの条件を持つメニューの数。一覧の見出しに出す。 */
export async function countRichMenuTargetingRules(
  db: D1Database,
  accountId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM rich_menu_groups
        WHERE account_id = ? AND targeting_enabled = 1 AND targeting_condition IS NOT NULL`,
    )
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
