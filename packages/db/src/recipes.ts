import { jstNow } from './utils.js';

/**
 * レシピと、レシピからの複製。設計 ★V6 34-2（`y0P0Qx`）/ 34-3（`D5UaX`）。台帳 #134。
 *
 * **レシピは実行基盤を持たない静的な見本**（要件 v6-34 §7-1）。
 * 複製すると、対象アカウントにふつうの定義が下書きで作られる。
 * 作られたものはレシピとつながらない。出どころだけを記録する。
 */

export interface RecipeRow {
  id: string;
  name: string;
  purpose: string;
  creates_summary: string;
  version: number;
  origin: 'builtin' | 'org';
  required_features: string;
  items_json: string | null;
  item_count: number | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeItem {
  kind: string;
  name: string;
  note: string;
}

export interface CloneRunRow {
  id: string;
  recipe_id: string;
  recipe_version: number;
  line_account_id: string;
  name_prefix: string | null;
  status: 'running' | 'succeeded' | 'failed';
  idempotency_key: string;
  created_count: number;
  failure_reason: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export function parseFeatures(row: RecipeRow): string[] {
  try {
    const value = JSON.parse(row.required_features);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 作られるものの内訳。
 *
 * **決まっていないものを埋めない。** 決まっていなければ `null` を返し、
 * 画面は「まだ決まっていません」と言う。**0 件の表を描かせない。**
 */
export function parseItems(row: RecipeRow): RecipeItem[] | null {
  if (!row.items_json) return null;
  try {
    const value = JSON.parse(row.items_json);
    return Array.isArray(value) ? (value as RecipeItem[]) : null;
  } catch {
    return null;
  }
}

/**
 * 足りない機能。
 *
 * **機能設定に行が無い機能を「オフ」と読まない。** 友だち属性のように
 * 切れない機能は表に無い。無いことをオフと読むと、どのレシピも使えなくなる。
 * だから `features` に明示的に `false` が入っているものだけを足りないと数える。
 */
export function missingFeatures(required: string[], features: Record<string, boolean>): string[] {
  return required.filter((key) => features[key] === false);
}

export async function listRecipes(db: D1Database): Promise<RecipeRow[]> {
  const result = await db
    .prepare(`SELECT * FROM recipes ORDER BY display_order, created_at`)
    .all<RecipeRow>();
  return result.results;
}

export async function getRecipeById(db: D1Database, id: string): Promise<RecipeRow | null> {
  return db.prepare(`SELECT * FROM recipes WHERE id = ?`).bind(id).first<RecipeRow>();
}

/** これまで何回作られたか。レシピごと。 */
export async function cloneCounts(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT recipe_id, COUNT(*) AS c FROM recipe_clone_runs
        WHERE status = 'succeeded' GROUP BY recipe_id`,
    )
    .all<{ recipe_id: string; c: number }>();
  return Object.fromEntries(result.results.map((r) => [r.recipe_id, r.c]));
}

export async function getCloneRun(db: D1Database, id: string): Promise<CloneRunRow | null> {
  return db.prepare(`SELECT * FROM recipe_clone_runs WHERE id = ?`).bind(id).first<CloneRunRow>();
}

export async function findRunByKey(
  db: D1Database,
  lineAccountId: string,
  idempotencyKey: string,
): Promise<CloneRunRow | null> {
  return db
    .prepare(`SELECT * FROM recipe_clone_runs WHERE line_account_id = ? AND idempotency_key = ?`)
    .bind(lineAccountId, idempotencyKey)
    .first<CloneRunRow>();
}

/** 名前のあたまに付ける文字を足した名前。空文字のときは何も足さない。 */
export function prefixedName(prefix: string | null | undefined, name: string): string {
  const head = (prefix ?? '').trim();
  return head ? `${head} ${name}` : name;
}

export async function startCloneRun(
  db: D1Database,
  input: {
    recipe: RecipeRow;
    lineAccountId: string;
    namePrefix?: string | null;
    idempotencyKey: string;
    createdBy?: string | null;
  },
): Promise<CloneRunRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO recipe_clone_runs
         (id, recipe_id, recipe_version, line_account_id, name_prefix, idempotency_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.recipe.id,
      input.recipe.version,
      input.lineAccountId,
      input.namePrefix ?? null,
      input.idempotencyKey,
      input.createdBy ?? null,
      jstNow(),
    )
    .run();
  return (await getCloneRun(db, id))!;
}

export async function recordCloneItem(
  db: D1Database,
  input: { runId: string; kind: string; targetId: string; name: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recipe_clone_items (id, run_id, kind, target_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), input.runId, input.kind, input.targetId, input.name, jstNow())
    .run();
}

export async function listCloneItems(
  db: D1Database,
  runId: string,
): Promise<Array<{ kind: string; target_id: string; name: string }>> {
  const result = await db
    .prepare(`SELECT kind, target_id, name FROM recipe_clone_items WHERE run_id = ? ORDER BY created_at`)
    .bind(runId)
    .all<{ kind: string; target_id: string; name: string }>();
  return result.results;
}

export async function finishCloneRun(
  db: D1Database,
  id: string,
  result: { status: 'succeeded' | 'failed'; createdCount: number; failureReason?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE recipe_clone_runs
          SET status = ?, created_count = ?, failure_reason = ?, finished_at = ?
        WHERE id = ?`,
    )
    .bind(result.status, result.createdCount, result.failureReason ?? null, jstNow(), id)
    .run();
}

/**
 * 途中で失敗したときに、作ったものを全部消す。
 *
 * **部分的に作らない**（要件 §7-3）。半分だけできた状態は、
 * 運用者が何を消せばよいか分からない。
 */
export async function rollbackCloneRun(db: D1Database, runId: string): Promise<void> {
  const items = await listCloneItems(db, runId);
  const byKind: Record<string, string> = {
    tag: 'tags',
    template: 'templates',
    scenario: 'scenarios',
    reminder: 'reminders',
  };
  for (const item of items) {
    const table = byKind[item.kind];
    if (!table) continue;
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(item.target_id).run();
  }
  await db.prepare(`DELETE FROM recipe_clone_items WHERE run_id = ?`).bind(runId).run();
}
