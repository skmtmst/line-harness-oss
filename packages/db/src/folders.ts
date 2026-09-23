import { jstNow } from './utils.js';

/**
 * 汎用フォルダ。
 *
 * 一覧13画面すべてにフォルダがある。画面ごとに別テーブルを足すと、
 * 同じものが13個できて「フォルダの作り方が画面ごとに違う」状態になる。
 * kind で使い分ける1つの表にした。
 *
 * タグの分類（旧 tag_groups）もここへ移送済み。tag_groups と tags.group_id は
 * 列を落とせないので残っているが、読み書きしない。
 */

export const FOLDER_KINDS = [
  'tag',
  'template',
  'scenario',
  'reminder',
  'auto_reply',
  'rich_menu',
  'webinar',
  'form',
  'media',
  'common_var',
  'mileage_rule',
  'automation',
  'event',
  'entry_route',
  'broadcast',
  // 友だち情報欄の分類。友だち詳細の上に並ぶタブ（飼い主情報・ペット
  // プロフィールなど）がこれ。friend_fields.folder_id が指す先。
  'friend_field',
] as const;

export type FolderKind = (typeof FOLDER_KINDS)[number];

export interface Folder {
  id: string;
  kind: string;
  /** 所有LINE公式アカウント。null は移行前の共有フォルダ。 */
  account_id: string | null;
  name: string;
  parent_id: string | null;
  display_order: number;
  /** #RRGGBB。未設定は null（画面では灰色で出す）。115 で追加。 */
  color: string | null;
  created_at: string;
  updated_at: string;
}

export function isFolderKind(value: unknown): value is FolderKind {
  return typeof value === 'string' && (FOLDER_KINDS as readonly string[]).includes(value);
}

export async function getFolders(
  db: D1Database,
  kind?: FolderKind,
  accountId?: string,
  scope?: FolderItemCountScope,
): Promise<Folder[]> {
  if (scope) {
    // Account-owned rows are never public. Only tag/webinar/template legacy rows have
    // the unassigned policy; other existing folder kinds keep their old list.
    const ids = accountId ? scope.allowedAccountIds.filter((id) => id === accountId) : scope.allowedAccountIds;
    const own = ids.length ? `account_id IN (${ids.map(() => "?").join(",")})` : "0";
    const legacy = scope.canSeeUnassigned ? "account_id IS NULL" : "(account_id IS NULL AND kind NOT IN ('tag', 'webinar', 'template'))";
    const result = await db.prepare(`SELECT * FROM folders WHERE (${own} OR ${legacy})${kind ? " AND kind = ?" : ""}
      ORDER BY kind ASC, display_order ASC, name ASC`).bind(...ids, ...(kind ? [kind] : [])).all<Folder>();
    return result.results;
  }
  if (kind === 'webinar' && accountId) {
    const result = await db
      .prepare(
        `SELECT * FROM folders
          WHERE kind = ? AND account_id = ?
          ORDER BY display_order ASC, name ASC`,
      )
      .bind(kind, accountId)
      .all<Folder>();
    return result.results;
  }
  if (kind) {
    const result = await db
      .prepare(
        `SELECT * FROM folders WHERE kind = ? ORDER BY display_order ASC, name ASC`,
      )
      .bind(kind)
      .all<Folder>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM folders ORDER BY kind ASC, display_order ASC, name ASC`)
    .all<Folder>();
  return result.results;
}

export async function getFolderById(db: D1Database, id: string): Promise<Folder | null> {
  return db.prepare(`SELECT * FROM folders WHERE id = ?`).bind(id).first<Folder>();
}

export async function createFolder(
  db: D1Database,
  input: {
    kind: FolderKind;
    name: string;
    parentId?: string | null;
    displayOrder?: number;
    color?: string | null;
    accountId?: string | null;
  },
): Promise<Folder> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO folders (id, kind, name, parent_id, display_order, color, account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.kind,
      input.name,
      input.parentId ?? null,
      input.displayOrder ?? 0,
      input.color ?? null,
      input.accountId ?? null,
      now,
      now,
    )
    .run();
  return (await getFolderById(db, id))!;
}

export async function updateFolder(
  db: D1Database,
  id: string,
  input: { name?: string; parentId?: string | null; displayOrder?: number; color?: string | null },
): Promise<Folder | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.color !== undefined) {
    sets.push('color = ?');
    values.push(input.color);
  }
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if ('parentId' in input) {
    sets.push('parent_id = ?');
    values.push(input.parentId ?? null);
  }
  if (input.displayOrder !== undefined) {
    sets.push('display_order = ?');
    values.push(input.displayOrder);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(jstNow(), id);
    await db
      .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  return getFolderById(db, id);
}

/**
 * 隣り合う2つのフォルダの並びを入れ替える（V6R-S2-c）。
 *
 * 以前は画面が2つのフォルダを別々に更新していたので、1回目だけ成功すると
 * 同じ番号のフォルダが2つ残った。2つの更新を1回のまとめ書き（batch）にする。
 *
 * 一覧は display_order → name の順に並ぶ。番号が同じ2つは名前で並んでいるので、
 * 番号を交換しても並びが変わらない。そのときは「後ろへ行くほう」を +1 する。
 * 全部の兄弟を振り直さないのは、同時に触った人の並びを上書きしないため。
 */
export async function swapFolderOrder(db: D1Database, a: Folder, b: Folder): Promise<void> {
  let aOrder = b.display_order;
  let bOrder = a.display_order;
  if (a.display_order === b.display_order) {
    const aIsFirst = a.name <= b.name;
    aOrder = aIsFirst ? a.display_order + 1 : a.display_order;
    bOrder = aIsFirst ? b.display_order : b.display_order + 1;
  }
  const now = jstNow();
  await db.batch([
    db.prepare('UPDATE folders SET display_order = ?, updated_at = ? WHERE id = ?').bind(aOrder, now, a.id),
    db.prepare('UPDATE folders SET display_order = ?, updated_at = ? WHERE id = ?').bind(bOrder, now, b.id),
  ]);
}

/**
 * フォルダを消す。中身は消えず「未分類」に戻る。
 *
 * どの参照も ON DELETE SET NULL にしてある。フォルダは入れ物であって
 * 中身ではないので、入れ物を捨てて中身まで捨てると、テンプレートや
 * シナリオが黙って消えることになる。
 *
 * 子フォルダだけは ON DELETE CASCADE で一緒に消える。空の入れ物が
 * 親を失って一覧の最上位に湧いてくる方が分かりにくいため。
 */
export async function deleteFolder(db: D1Database, id: string): Promise<boolean> {
  // Older data may have a foreign-account descendant. Never cascade across it.
  const result = await db.prepare(`WITH RECURSIVE children(id, account_id, kind) AS (
    SELECT id, account_id, kind FROM folders WHERE parent_id = ?
    UNION SELECT f.id, f.account_id, f.kind FROM folders f JOIN children c ON f.parent_id = c.id
  ) DELETE FROM folders WHERE id = ? AND NOT EXISTS (
    SELECT 1 FROM children c WHERE c.account_id IS NOT folders.account_id OR c.kind <> folders.kind
  ) AND (kind <> 'tag' OR NOT EXISTS (
    SELECT 1 FROM tags t WHERE (t.folder_id = folders.id OR t.folder_id IN (SELECT id FROM children))
      AND t.line_account_id IS NOT folders.account_id
  ))`).bind(id, id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

/** kind ごとの件数。画面のタブに数字を出すため。 */
export async function countFoldersByKind(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(`SELECT kind, COUNT(*) AS c FROM folders GROUP BY kind`)
    .all<{ kind: string; c: number }>();
  const out: Record<string, number> = {};
  for (const row of result.results) out[row.kind] = Number(row.c);
  return out;
}

/**
 * `GET /api/folders` がフォルダごとの件数を返すための、kind→対象テーブル対応表（#631）。
 *
 * ここに載っているのは、一覧画面のアカウント可視範囲が
 * `allowedAccountIds`（配列）＋`canSeeUnassigned`（未割当を含むか）という
 * 同じ形で揃っている6種別だけ。**残り9種別（`webinar` を除く）は、機械的に
 * 数えると母集団を誤るため、意図して対応表に入れていない。**
 *
 * 対応表に無い理由:
 * - `event`: 正しい数え方は `account_ids` JSON 基準で確定しているが（#730 調査）、
 *   現時点では events 画面にフォルダ UI も `folders.list('event')` の利用先も無い。
 *   使われない集計は増やさない。将来フォルダ UI を接続する票で、B視点の数え漏らし
 *   試験と一緒に実装する（#730 裁定）。
 * - `friend_field`: scope 表（`friend_field_scopes`）基準が正しいことは確定しているが
 *   （#730 調査）、現時点では件数の利用先が無い。利用画面を作る時に接続する。
 *   テナント全体の無条件集計は採らない（他テナント混入のため）（#730 裁定）。
 * - `automation` / `entry_route` / `mileage_rule` / `form`: `folder_id` 列を
 *   持つテーブルが存在せず、どの画面からも `kind` 指定で呼ばれていない
 *   （汎用フォルダ機構が未使用の種別）
 *
 * `webinar` はここには含めない。`getWebinarFolderCounts`（`webinars.ts`）が
 * 既にアカウント境界込みで実装済みで、呼び出し側（`GET /api/folders`）が
 * 種別で分岐してそちらを使う。
 */
export const FOLDER_ITEM_COUNT_TABLES: Partial<Record<FolderKind, {
  table: string;
  accountColumn: string;
  /**
   * 一覧が既定で掛けている絞り込み。件数も同じ母集団で数えるために要る。
   * ここが無いと、一覧に出ない行がフォルダ件数にだけ残る（独立審査 #631）。
   *
   * 残りの種別には付けない。いま一覧側が何も絞っていないため、付けると
   * 逆に母集団がずれる。一覧側の絞り込みが増えたら、そのときここへ足す。
   */
  listFilter?: string;
}>> = {
  // 一覧は deleted_at IS NULL で絞る(apps/worker/src/routes/reminders.ts:425)。
  reminder: { table: 'reminders', accountColumn: 'line_account_id', listFilter: 'deleted_at IS NULL' },
  scenario: { table: 'scenarios', accountColumn: 'line_account_id' },
  tag: { table: 'tags', accountColumn: 'line_account_id' },
  template: { table: 'templates', accountColumn: 'line_account_id' },
  // 一覧は deleted_at IS NULL で絞る(packages/db/src/auto-replies.ts:76)。
  auto_reply: { table: 'auto_replies', accountColumn: 'line_account_id', listFilter: 'deleted_at IS NULL' },
  broadcast: { table: 'broadcasts', accountColumn: 'line_account_id' },
  // #730: media / common_var / rich_menu は一覧が単一アカウントに閉じて
  // いるため、単一アカウント方式で数える。common_var は一覧と同じく
  // archived（archived_at IS NOT NULL）を除く。media の kind 等の追加絞りは
  // 件数へ入れず、選択中アカウント内のフォルダ総数にする（#631 の流儀）。
  media: { table: 'media', accountColumn: 'line_account_id' },
  common_var: { table: 'common_vars', accountColumn: 'line_account_id', listFilter: 'archived_at IS NULL' },
  rich_menu: { table: 'rich_menu_groups', accountColumn: 'account_id' },
};

export interface FolderItemCountScope {
  allowedAccountIds: string[];
  canSeeUnassigned: boolean;
}

export interface FolderItemCounts {
  /** フォルダIDごとの件数。0件のフォルダはキー自体が無い（GROUP BYの性質）。 */
  byFolderId: Record<string, number>;
  /** `folder_id IS NULL`（未分類）の件数。一覧の「未分類」タブと同じ母集団。 */
  unfiled: number;
}

/**
 * フォルダ内訳の件数を、一覧画面と同じ母集団（アカウント可視範囲）で数える。
 *
 * `kind` が {@link FOLDER_ITEM_COUNT_TABLES} に無ければ `undefined` を返す。
 * **`undefined` は「0件」ではなく「数えていない」。**呼び出し側はこれを
 * `0` へ読み替えず、「件数不明（—）」として扱うこと。
 */
export async function getFolderItemCounts(
  db: D1Database,
  kind: FolderKind,
  scope: FolderItemCountScope,
): Promise<FolderItemCounts | undefined> {
  const target = FOLDER_ITEM_COUNT_TABLES[kind];
  if (!target) return undefined;
  const { table, accountColumn, listFilter } = target;
  const accountSql = scope.allowedAccountIds.length > 0
    ? `${accountColumn} IN (${scope.allowedAccountIds.map(() => '?').join(',')})`
    : null;
  let scopeSql: string;
  let bindings: string[];
  if (accountSql && scope.canSeeUnassigned) {
    scopeSql = `(${accountSql} OR ${accountColumn} IS NULL)`;
    bindings = scope.allowedAccountIds;
  } else if (accountSql) {
    scopeSql = accountSql;
    bindings = scope.allowedAccountIds;
  } else {
    scopeSql = scope.canSeeUnassigned ? `${accountColumn} IS NULL` : '1 = 0';
    bindings = [];
  }
  // folder_id ごとの内訳と未分類は別の集計（GROUP BY は NULL を1グループ
  // として返さないため、未分類だけ別クエリが要る）。Promise.all で
  // 並列に投げ、直列2往復にはしない。
  const listSql = listFilter ? ` AND ${listFilter}` : '';
  const [byFolderResult, unfiledResult] = await Promise.all([
    db.prepare(
      `SELECT folder_id, COUNT(*) AS item_count FROM ${table}
        WHERE folder_id IS NOT NULL AND ${scopeSql}${listSql}
        GROUP BY folder_id`,
    ).bind(...bindings).all<{ folder_id: string; item_count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS unfiled_count FROM ${table}
        WHERE folder_id IS NULL AND ${scopeSql}${listSql}`,
    ).bind(...bindings).first<{ unfiled_count: number }>(),
  ]);
  const byFolderId = Object.fromEntries(
    (byFolderResult.results ?? []).map((row) => [row.folder_id, Number(row.item_count)]),
  );
  return { byFolderId, unfiled: Number(unfiledResult?.unfiled_count ?? 0) };
}
