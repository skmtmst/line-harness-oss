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
  /** ウェビナー用フォルダの所有LINE公式アカウント。ほかの種類は null。 */
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
): Promise<Folder[]> {
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
 * フォルダを消す。中身は消えず「未分類」に戻る。
 *
 * どの参照も ON DELETE SET NULL にしてある。フォルダは入れ物であって
 * 中身ではないので、入れ物を捨てて中身まで捨てると、テンプレートや
 * シナリオが黙って消えることになる。
 *
 * 子フォルダだけは ON DELETE CASCADE で一緒に消える。空の入れ物が
 * 親を失って一覧の最上位に湧いてくる方が分かりにくいため。
 */
export async function deleteFolder(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM folders WHERE id = ?`).bind(id).run();
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
 * 対応表に無い理由（#730 で扱う）:
 * - `media` / `common_var`: 一覧APIが `accountId` 単体必須で、複数アカウント
 *   横断で絞る `allowedAccountIds` 配列と前提が噛み合わない
 * - `rich_menu`: 対象テーブル(`rich_menu_groups`)の列名が `account_id`
 *   （他は `line_account_id`）で、一覧用に一般化されたスコープ取得口が無い
 * - `event`: `target_type='multi-account-dedup'` のとき、実際は複数アカウント
 *   に跨るものを代表1件だけ `line_account_id` へ「センチネル」として保存する
 *   （`apps/worker/src/routes/events.ts`）。単純な `line_account_id` の
 *   COUNTでは正しい母集団を数えられない
 * - `friend_field`: `friend_fields` テーブルに `line_account_id`/`account_id`
 *   のどちらの列も無く、アカウントで絞るという前提自体が成り立たない
 * - `automation` / `entry_route` / `mileage_rule` / `form`: `folder_id` 列を
 *   持つテーブルが存在せず、どの画面からも `kind` 指定で呼ばれていない
 *   （汎用フォルダ機構が未使用の種別）
 *
 * `webinar` はここには含めない。`getWebinarFolderCounts`（`webinars.ts`）が
 * 既にアカウント境界込みで実装済みで、呼び出し側（`GET /api/folders`）が
 * 種別で分岐してそちらを使う。
 */
export const FOLDER_ITEM_COUNT_TABLES: Partial<Record<FolderKind, { table: string; accountColumn: string }>> = {
  reminder: { table: 'reminders', accountColumn: 'line_account_id' },
  scenario: { table: 'scenarios', accountColumn: 'line_account_id' },
  tag: { table: 'tags', accountColumn: 'line_account_id' },
  template: { table: 'templates', accountColumn: 'line_account_id' },
  auto_reply: { table: 'auto_replies', accountColumn: 'line_account_id' },
  broadcast: { table: 'broadcasts', accountColumn: 'line_account_id' },
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
  const { table, accountColumn } = target;
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
  const [byFolderResult, unfiledResult] = await Promise.all([
    db.prepare(
      `SELECT folder_id, COUNT(*) AS item_count FROM ${table}
        WHERE folder_id IS NOT NULL AND ${scopeSql}
        GROUP BY folder_id`,
    ).bind(...bindings).all<{ folder_id: string; item_count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS unfiled_count FROM ${table}
        WHERE folder_id IS NULL AND ${scopeSql}`,
    ).bind(...bindings).first<{ unfiled_count: number }>(),
  ]);
  const byFolderId = Object.fromEntries(
    (byFolderResult.results ?? []).map((row) => [row.folder_id, Number(row.item_count)]),
  );
  return { byFolderId, unfiled: Number(unfiledResult?.unfiled_count ?? 0) };
}
