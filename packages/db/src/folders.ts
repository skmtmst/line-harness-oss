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
  // 友だち情報欄の分類。友だち詳細の上に並ぶタブ（飼い主情報・ペット
  // プロフィールなど）がこれ。friend_fields.folder_id が指す先。
  'friend_field',
] as const;

export type FolderKind = (typeof FOLDER_KINDS)[number];

export interface Folder {
  id: string;
  kind: string;
  name: string;
  parent_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function isFolderKind(value: unknown): value is FolderKind {
  return typeof value === 'string' && (FOLDER_KINDS as readonly string[]).includes(value);
}

export async function getFolders(db: D1Database, kind?: FolderKind): Promise<Folder[]> {
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
  input: { kind: FolderKind; name: string; parentId?: string | null; displayOrder?: number },
): Promise<Folder> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO folders (id, kind, name, parent_id, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.kind, input.name, input.parentId ?? null, input.displayOrder ?? 0, now, now)
    .run();
  return (await getFolderById(db, id))!;
}

export async function updateFolder(
  db: D1Database,
  id: string,
  input: { name?: string; parentId?: string | null; displayOrder?: number },
): Promise<Folder | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
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
