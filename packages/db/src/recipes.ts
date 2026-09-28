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
  /**
   * 組織レシピの持ち主のアカウント。`builtin` は NULL（全組織共通）。
   * 組織レシピは作った組織の範囲にだけ見える（要件 §7-5）。
   */
  line_account_id: string | null;
  created_by_staff_id: string | null;
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
  /** レシピ内の参照に使う安定キー。無い場合は種類と順番から作る。 */
  ref?: string;
  /** 種類ごとの下書き設定。確定していない値は入れない。 */
  config?: Record<string, unknown>;
}

export interface CloneRunRow {
  id: string;
  recipe_id: string;
  recipe_version: number;
  line_account_id: string;
  name_prefix: string | null;
  status: 'queued' | 'succeeded' | 'failed' | 'rolled_back';
  idempotency_key: string;
  request_fingerprint: string;
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

/**
 * 見えるレシピ。
 *
 * **組織レシピは持ち主の範囲にだけ出す。** アカウントが決まっていなければ
 * 初期同梱（`builtin`）だけを返す——別の組織のレシピをこぼさない。
 */
export async function listRecipes(db: D1Database, accountId?: string | null): Promise<RecipeRow[]> {
  const result = accountId
    ? await db
        .prepare(
          `SELECT * FROM recipes
            WHERE line_account_id IS NULL OR line_account_id = ?
            ORDER BY display_order, created_at`,
        )
        .bind(accountId)
        .all<RecipeRow>()
    : await db
        .prepare(`SELECT * FROM recipes WHERE line_account_id IS NULL ORDER BY display_order, created_at`)
        .all<RecipeRow>();
  return result.results;
}

/**
 * 1件を引く。`accountId` を渡すと、ほかの組織のレシピは無いものとして扱う
 * （範囲外は 404——要件 §13）。
 */
export async function getRecipeById(
  db: D1Database,
  id: string,
  accountId?: string | null,
): Promise<RecipeRow | null> {
  const row = await db.prepare(`SELECT * FROM recipes WHERE id = ?`).bind(id).first<RecipeRow>();
  if (!row) return null;
  if (accountId !== undefined && row.line_account_id !== null && row.line_account_id !== accountId) {
    return null;
  }
  return row;
}

/**
 * 組織レシピを作る（§7-5）。`origin` は常に `'org'`。
 *
 * **見本は版付き JSON で持つ。** 複製したあとにレシピを新版にしても、
 * 作られた定義は変わらない（§7-4）。
 */
export async function createRecipe(
  db: D1Database,
  input: {
    name: string;
    purpose: string;
    createsSummary: string;
    requiredFeatures?: string[];
    items?: RecipeItem[] | null;
    lineAccountId: string;
    createdByStaffId?: string | null;
  },
): Promise<RecipeRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const itemsJson = input.items ? JSON.stringify(input.items) : null;
  await db
    .prepare(
      `INSERT INTO recipes
         (id, name, purpose, creates_summary, version, origin, line_account_id,
          created_by_staff_id, required_features, items_json, item_count,
          display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'org', ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.purpose,
      input.createsSummary,
      input.lineAccountId,
      input.createdByStaffId ?? null,
      JSON.stringify(input.requiredFeatures ?? []),
      itemsJson,
      input.items ? input.items.length : null,
      now,
      now,
    )
    .run();
  const saved = await getRecipeById(db, id);
  if (!saved) throw new Error('recipe_not_saved');
  return saved;
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
    requestFingerprint: string;
    createdBy?: string | null;
  },
): Promise<CloneRunRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO recipe_clone_runs
         (id, recipe_id, recipe_version, line_account_id, name_prefix, status,
          idempotency_key, request_fingerprint, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.recipe.id,
      input.recipe.version,
      input.lineAccountId,
      input.namePrefix ?? null,
      input.idempotencyKey,
      input.requestFingerprint,
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
  result: {
    status: 'succeeded' | 'failed' | 'rolled_back';
    createdCount: number;
    failureReason?: string | null;
  },
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
