import { jstNow } from './utils.js';
import { type CreateRichMenuGroupInput, type RichMenuGroupWithPages, type UpdateRichMenuGroupMetaInput, type RichMenuPageInput, type PageKeepMeta, type RichMenuAreaInput, type SaveRichMenuGroupDraftInput, type SaveRichMenuGroupDraftResult } from './rich-menus-types.js';
import { buildRichMenuAliasId, buildAreaInsert, getRichMenuGroupWithPages } from './rich-menus-reads.js';


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
  // N-161: 既定ページは作成時に決められる。未指定なら先頭ページ（従来どおり）。
  const defaultPage =
    (input.defaultPageIndex !== undefined && input.defaultPageIndex !== null
      ? pageRecords.find((p) => p.orderIndex === input.defaultPageIndex)
      : undefined) ?? pageRecords[0];
  const defaultPageId = defaultPage?.id ?? null;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO rich_menu_groups
           (id, account_id, name, chat_bar_text, size, default_page_id,
            folder_id, is_default_for_all, status,
            targeting_condition, targeting_priority, targeting_enabled,
            default_open, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        groupId,
        input.accountId,
        input.name,
        input.chatBarText,
        input.size,
        defaultPageId,
        input.folderId ?? null,
        input.isDefaultForAll ? 1 : 0,
        input.targetingCondition ?? null,
        input.targetingPriority ?? 0,
        input.targetingEnabled ? 1 : 0,
        input.defaultOpen ? 1 : 0,
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
      // N-161: 作成時の richmenuswitch はまだ page.id が無いので、画面からは
      // actionData.targetPageIndex (orderIndex) で受け、ここで実IDへ解決する。
      // 解決しても1 batch 内なので、失敗時に半分だけ残ることはない。
      let area = a;
      if (a.actionType === 'richmenuswitch' && a.actionData) {
        const rawIndex = a.actionData.targetPageIndex;
        if (typeof rawIndex === 'number' && Number.isInteger(rawIndex)) {
          const target = pageRecords.find((page) => page.orderIndex === rawIndex);
          if (target) {
            const { targetPageIndex: _drop, ...rest } = a.actionData;
            area = { ...a, actionData: { ...rest, targetPageId: target.id } };
          }
        }
      }
      stmts.push(buildAreaInsert(db, crypto.randomUUID(), p.id, area, now));
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
  const built = buildMetaSets(patch);
  if (!built) return;
  const now = jstNow();
  await db
    .prepare(`UPDATE rich_menu_groups SET ${built.sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...built.vals, now, id)
    .run();
}

/** meta の差分を SET 句へ写す。差分が無ければ null。 */
export function buildMetaSets(patch: UpdateRichMenuGroupMetaInput): { sets: string[]; vals: unknown[] } | null {
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
  if (patch.folderId !== undefined) {
    sets.push('folder_id = ?');
    vals.push(patch.folderId);
  }
  if (patch.displayOrder !== undefined) {
    sets.push('display_order = ?');
    vals.push(patch.displayOrder);
  }
  if (patch.defaultOpen !== undefined) {
    sets.push('default_open = ?');
    vals.push(patch.defaultOpen ? 1 : 0);
  }
  if (sets.length === 0) return null;
  return { sets, vals };
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
  const keep = await loadPageKeepMeta(db, groupId);
  const stmts = buildPageReplaceStatements(db, groupId, pages, keep, now);
  await db.batch(stmts);
}

/**
 * ページ置換で引き継ぐ既存メタ (image / line_richmenu_id / created_at と
 * area id) を読む。押された回数は area id を軸に数えるので、保存のたびに
 * 振り直すと、同じボタンの記録がそこで途切れてしまう。
 * 引き継ぐのは「この group に今ある id」だけ。別 group の id や消えた id を
 * そのまま挿すと PK が衝突する (page 側と同じ考え方)。
 */
export async function loadPageKeepMeta(db: D1Database, groupId: string): Promise<PageKeepMeta> {
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
  return { existingMap, existingAreaIds };
}

/**
 * ページ置換の書き込み文を作る (DELETE → 復元 INSERT)。
 * 呼び出し側が 1 batch で流す。meta 更新と束ねるときは同じ batch へ足す。
 */
export function buildPageReplaceStatements(
  db: D1Database,
  groupId: string,
  pages: RichMenuPageInput[],
  keep: PageKeepMeta,
  now: string,
): D1PreparedStatement[] {
  const { existingMap, existingAreaIds } = keep;
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

  return stmts;
}

/**
 * 版の番人が落ちたときの印。番人は SELECT 1 文で、版が合わない
 * （行が無い場合も含む）ときだけ壊れた JSON を読んで batch 全体を
 * 止める。batch 内の正規文は JSON.stringify 済みしか扱わないので、
 * malformed JSON は番人以外から出ない。
 */
export function isVersionGuardTrip(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /malformed JSON/i.test(message);
}

/**
 * 下書き保存を1件の取引で確定する (M950/M951)。
 *
 * 版の検査・版上げ・書込をすべて 1 batch で流す。batch の先頭に版の
 * 番人を置き、期待の版と違うときは番人で batch 全体を失敗させて
 * 何も書かず version_conflict (route が 409 へ写す)。本番 D1 の batch は
 * 原子（試験の createTestD1 も同じく取引で包む）なので、検査と書込の
 * 間に別の保存が割り込めない。古い書込が最後に来ても黙って上書き
 * しない。失敗時は版も進まないので、読み直さずに保存し直せる。
 */
export async function saveRichMenuGroupDraft(
  db: D1Database,
  groupId: string,
  input: SaveRichMenuGroupDraftInput,
): Promise<SaveRichMenuGroupDraftResult> {
  const metaBuilt = buildMetaSets(input.meta);
  // 書くものが無ければ読むだけ。版も進めない。
  if (!metaBuilt && !input.pages) {
    const current = await db
      .prepare(`SELECT version FROM rich_menu_groups WHERE id = ?`)
      .bind(groupId)
      .first<{ version: number }>();
    if (!current || current.version !== input.expectedVersion) {
      return { ok: false, reason: 'version_conflict', currentVersion: current?.version ?? null };
    }
    return { ok: true, version: current.version };
  }
  const now = jstNow();
  const keep = input.pages ? await loadPageKeepMeta(db, groupId) : null;
  const stmts: D1PreparedStatement[] = [];
  // 版の番人。期待の版と違う（行が無い場合も含む）ときだけ1行を作り、
  // 壊れた JSON を読んで失敗し、batch 全体を戻す。合っているときは
  // 何も作らず素通りする。SELECT なので副作用は無い。
  stmts.push(
    db
      .prepare(
        `SELECT json('__RICH_MENU_VERSION_GUARD_TRIPPED__')
           WHERE (SELECT version FROM rich_menu_groups WHERE id = ?) IS DISTINCT FROM ?`,
      )
      .bind(groupId, input.expectedVersion),
  );
  if (metaBuilt) {
    stmts.push(
      db
        .prepare(
          `UPDATE rich_menu_groups SET ${metaBuilt.sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .bind(...metaBuilt.vals, now, groupId),
    );
  } else {
    stmts.push(
      db
        .prepare(`UPDATE rich_menu_groups SET version = version + 1, updated_at = ? WHERE id = ?`)
        .bind(now, groupId),
    );
  }
  if (input.pages && keep) {
    stmts.push(...buildPageReplaceStatements(db, groupId, input.pages, keep, now));
  }
  try {
    await db.batch(stmts);
  } catch (error) {
    if (isVersionGuardTrip(error)) {
      const reread = await db
        .prepare(`SELECT version FROM rich_menu_groups WHERE id = ?`)
        .bind(groupId)
        .first<{ version: number }>();
      return { ok: false, reason: 'version_conflict', currentVersion: reread?.version ?? null };
    }
    throw error;
  }
  return { ok: true, version: input.expectedVersion + 1 };
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
