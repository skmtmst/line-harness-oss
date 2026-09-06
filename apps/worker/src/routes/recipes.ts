import { Hono } from 'hono';
import {
  cloneCounts,
  finishCloneRun,
  findRunByKey,
  getCloneRun,
  getRecipeById,
  listCloneItems,
  listRecipes,
  missingFeatures,
  parseFeatures,
  parseItems,
  prefixedName,
  startCloneRun,
  type RecipeRow,
  type RecipeItem,
} from '@line-crm/db';
import { getVersionedAccountSetting } from '@line-crm/db';
import type { Env } from '../index.js';

/** 機能設定の保存キー。`routes/feature-settings.ts` と同じ値。 */
const FEATURE_SETTINGS_BUNDLE_KEY = 'feature.settings_bundle_v1';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { sha256Hex, type AuthenticatedStaff } from '../middleware/auth.js';

/**
 * レシピ。設計 ★V6 34-2（`y0P0Qx`）/ 34-3（`D5UaX`）。台帳 #134。
 *
 * **複製の途中失敗は全部戻す**（要件 v6-34 §7-3）。部分的に作らない。
 * 半分だけできた状態は、運用者が何を消せばよいか分からない。
 */
const recipes = new Hono<Env>();

type CloneKind = 'tag' | 'template' | 'scenario' | 'reminder' | 'auto_reply' | 'friend_add_rule';
type PreparedCloneItem = RecipeItem & { kind: CloneKind; id: string; name: string };

const KIND_ALIASES: Record<string, CloneKind> = {
  tag: 'tag',
  'タグ': 'tag',
  template: 'template',
  'テンプレート': 'template',
  scenario: 'scenario',
  'シナリオ': 'scenario',
  reminder: 'reminder',
  'リマインダ': 'reminder',
  auto_reply: 'auto_reply',
  '自動応答': 'auto_reply',
  friend_add_rule: 'friend_add_rule',
  '友だち追加時のルール': 'friend_add_rule',
};

const FEATURE_EDIT_PERMISSIONS: Partial<Record<CloneKind, string[]>> = {
  tag: ['/tags', 'tag.definition.edit'],
  template: ['/templates', 'template.definition.edit'],
  scenario: ['/scenarios', 'scenario.definition.edit'],
  reminder: ['/reminders', 'reminder.definition.edit'],
  auto_reply: ['/auto-replies', 'auto_reply.definition.edit'],
  friend_add_rule: ['/friend-add-settings', 'friend_add.definition.edit'],
};

function missingEditPermissions(
  staff: AuthenticatedStaff | undefined,
  items: PreparedCloneItem[],
): string[] {
  if (staff?.role === 'owner' || staff?.role === 'admin') return [];
  if (!staff?.permissionKeys?.includes('recipe.definition.clone')) return ['recipe.definition.clone'];
  return [...new Set(items.flatMap((item) => {
    const aliases = FEATURE_EDIT_PERMISSIONS[item.kind] ?? [];
    return aliases.some((permission) => staff.permissionKeys?.includes(permission))
      ? []
      : [aliases.at(-1) ?? item.kind];
  }))];
}

function prepareItems(items: RecipeItem[], prefix: string | null | undefined):
  | { ok: true; items: PreparedCloneItem[] }
  | { ok: false; unsupported: string[] } {
  const unsupported = [...new Set(items.map((item) => item.kind).filter((kind) => !KIND_ALIASES[kind]))];
  if (unsupported.length > 0) return { ok: false, unsupported };
  return {
    ok: true,
    items: items.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      kind: KIND_ALIASES[item.kind]!,
      name: prefixedName(prefix, item.name),
    })),
  };
}

function stringConfig(item: PreparedCloneItem, key: string, fallback: string): string {
  const value = item.config?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cloneStatements(
  db: D1Database,
  recipe: RecipeRow,
  runId: string,
  accountId: string,
  items: PreparedCloneItem[],
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const idsByRef = new Map(items.map((item, index) => [item.ref ?? `${item.kind}:${index}`, item.id]));
  const statements: D1PreparedStatement[] = [];
  for (const [index, item] of items.entries()) {
    if (item.kind === 'tag') {
      statements.push(db.prepare(
        `INSERT INTO tags
           (id, name, description, line_account_id, status, created_from_recipe_id,
            recipe_clone_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(item.id, item.name, item.note, accountId, recipe.id, runId, now, now));
    } else if (item.kind === 'template') {
      statements.push(db.prepare(
        `INSERT INTO templates
           (id, name, category, message_type, message_content, question_status,
            line_account_id, created_from_recipe_id, recipe_clone_run_id, created_at, updated_at)
         VALUES (?, ?, 'general', 'text', ?, 'draft', ?, ?, ?, ?, ?)`,
      ).bind(
        item.id,
        item.name,
        stringConfig(item, 'messageContent', item.note),
        accountId,
        recipe.id,
        runId,
        now,
        now,
      ));
    } else if (item.kind === 'scenario') {
      statements.push(db.prepare(
        `INSERT INTO scenarios
           (id, name, description, trigger_type, line_account_id, is_active,
            created_from_recipe_id, recipe_clone_run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, 0, ?, ?, ?, ?)`,
      ).bind(item.id, item.name, item.note, accountId, recipe.id, runId, now, now));
    } else if (item.kind === 'reminder') {
      statements.push(db.prepare(
        `INSERT INTO reminders
           (id, name, description, is_active, line_account_id, trigger_type,
            lifecycle_status, created_from_recipe_id, recipe_clone_run_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 'manual', 'draft', ?, ?, ?, ?)`,
      ).bind(item.id, item.name, item.note, accountId, recipe.id, runId, now, now));
    } else if (item.kind === 'auto_reply') {
      statements.push(db.prepare(
        `INSERT INTO auto_replies
           (id, name, keyword, match_type, response_type, response_content, line_account_id,
            is_active, lifecycle_status, created_from_recipe_id, recipe_clone_run_id, created_at)
         VALUES (?, ?, ?, 'exact', 'text', ?, ?, 0, 'draft', ?, ?, ?)`,
      ).bind(
        item.id,
        item.name,
        stringConfig(item, 'keyword', item.name),
        stringConfig(item, 'responseContent', item.note),
        accountId,
        recipe.id,
        runId,
        now,
      ));
    } else {
      const versionId = crypto.randomUUID();
      const scenarioRef = item.config?.scenarioRef;
      const scenarioId = typeof scenarioRef === 'string' ? idsByRef.get(scenarioRef) ?? null : null;
      const definition = {
        routeIds: [],
        scenarioId,
        messageType: scenarioId ? 'scenario' : 'text',
        messageText: scenarioId ? '' : stringConfig(item, 'messageText', item.note),
        timing: 'immediate',
        actions: [],
        friendCondition: '',
        activeFrom: null,
        activeUntil: null,
      };
      statements.push(db.prepare(
        `INSERT INTO friend_add_rules
           (id, line_account_id, friend_kind, name, priority, is_unknown_route_fallback,
            status, current_version_id, created_from_recipe_id, recipe_clone_run_id,
            created_at, updated_at)
         VALUES (?, ?, 'first_time', ?, ?, 0, 'draft', ?, ?, ?, ?, ?)`,
      ).bind(item.id, accountId, item.name, index + 1, versionId, recipe.id, runId, now, now));
      statements.push(db.prepare(
        `INSERT INTO friend_add_rule_versions
           (id, rule_id, version_number, definition_snapshot, status, created_at, updated_at)
         VALUES (?, ?, 1, ?, 'draft', ?, ?)`,
      ).bind(versionId, item.id, JSON.stringify(definition), now, now));
    }
    statements.push(db.prepare(
      `INSERT INTO recipe_clone_items (id, run_id, kind, target_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), runId, item.kind, item.id, item.name, now));
  }
  statements.push(db.prepare(
    `UPDATE recipe_clone_runs
        SET status = 'succeeded', created_count = ?, failure_reason = NULL, finished_at = ?
      WHERE id = ? AND status = 'queued'`,
  ).bind(items.length, now, runId));
  return statements;
}

async function findNameConflicts(
  db: D1Database,
  accountId: string,
  items: PreparedCloneItem[],
): Promise<Array<{ kind: CloneKind; name: string }>> {
  const seen = new Set<string>();
  const conflicts: Array<{ kind: CloneKind; name: string }> = [];
  const tables: Record<CloneKind, { table: string; scoped: boolean }> = {
    tag: { table: 'tags', scoped: false },
    template: { table: 'templates', scoped: true },
    scenario: { table: 'scenarios', scoped: true },
    reminder: { table: 'reminders', scoped: true },
    auto_reply: { table: 'auto_replies', scoped: true },
    friend_add_rule: { table: 'friend_add_rules', scoped: true },
  };
  for (const item of items) {
    const duplicateKey = `${item.kind}:${item.name}`;
    if (seen.has(duplicateKey)) {
      conflicts.push({ kind: item.kind, name: item.name });
      continue;
    }
    seen.add(duplicateKey);
    const target = tables[item.kind];
    const row = target.scoped
      ? await db.prepare(`SELECT 1 AS hit FROM ${target.table} WHERE line_account_id = ? AND name = ? LIMIT 1`)
        .bind(accountId, item.name).first<{ hit: number }>()
      : await db.prepare(`SELECT 1 AS hit FROM ${target.table} WHERE name = ? LIMIT 1`)
        .bind(item.name).first<{ hit: number }>();
    if (row) conflicts.push({ kind: item.kind, name: item.name });
  }
  return conflicts;
}

/**
 * 機能設定のオン・オフ。
 *
 * **保存が無いときを「全部オフ」と読まない。** 一度も触っていない組織は
 * 保存が無いだけで、既定はオンのものが多い。空を返し、
 * `missingFeatures` が「明示的に false のものだけ」を数える形にしてある。
 */
async function readFeatures(db: D1Database, accountId: string): Promise<Record<string, boolean>> {
  const saved = await getVersionedAccountSetting<{ features?: Record<string, boolean> }>(
    db,
    accountId,
    FEATURE_SETTINGS_BUNDLE_KEY,
  );
  return saved?.data.features ?? {};
}

function serialize(recipe: RecipeRow, counts: Record<string, number>, features: Record<string, boolean>) {
  const required = parseFeatures(recipe);
  const missing = missingFeatures(required, features);
  return {
    id: recipe.id,
    name: recipe.name,
    purpose: recipe.purpose,
    creates: recipe.creates_summary,
    version: recipe.version,
    origin: recipe.origin,
    requiredFeatures: required,
    /** オフの機能。**空配列は「全部オン」。** */
    missingFeatures: missing,
    /** 作られるものの内訳。**決まっていなければ null**（0 件の表を描かせない）。 */
    items: parseItems(recipe),
    itemCount: recipe.item_count,
    /** これまで何回作られたか。**数えられるようになった**（台帳 #134 前は出せなかった）。 */
    cloneCount: counts[recipe.id] ?? 0,
  };
}

recipes.get('/api/recipes', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('account_id') ?? c.req.query('accountId') ?? null;
    if (accountId && !(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const [rows, counts] = await Promise.all([listRecipes(c.env.DB), cloneCounts(c.env.DB)]);
    const features = accountId ? await readFeatures(c.env.DB, accountId) : {};
    return c.json({ success: true, data: rows.map((r) => serialize(r, counts, features)) });
  } catch (err) {
    console.error('GET /api/recipes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

recipes.get('/api/recipes/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const recipe = await getRecipeById(c.env.DB, c.req.param('id'));
    if (!recipe) return c.json({ success: false, error: 'Not found' }, 404);
    const accountId = c.req.query('account_id') ?? c.req.query('accountId') ?? null;
    if (accountId && !(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const [counts, features] = await Promise.all([
      cloneCounts(c.env.DB),
      accountId ? readFeatures(c.env.DB, accountId) : Promise.resolve({}),
    ]);
    return c.json({ success: true, data: serialize(recipe, counts, features) });
  } catch (err) {
    console.error('GET /api/recipes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 複製する。
 *
 * **冪等キーが要る。** 同じキーで2回呼ばれても2回作らない。
 * 押し直しや再送で、下書きが二重にできるのを防ぐ。
 */
recipes.post('/api/recipes/:id/clone', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return c.json({ success: false, error: 'Idempotency-Key が要ります', code: 'INVALID_INPUT' }, 400);
    }
    const recipe = await getRecipeById(c.env.DB, c.req.param('id'));
    if (!recipe) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{
      accountId?: string;
      namePrefix?: string | null;
      expectedVersion?: number;
    }>();
    if (!body.accountId || !Number.isInteger(body.expectedVersion)) {
      return c.json({ success: false, error: 'accountId が要ります' }, 400);
    }
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (body.expectedVersion !== recipe.version) {
      return c.json({
        success: false,
        error: 'レシピが更新されました。最新の内容を確認してください。',
        code: 'VERSION_CONFLICT',
      }, 409);
    }

    const fingerprint = await sha256Hex(JSON.stringify({
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      accountId: body.accountId,
      namePrefix: body.namePrefix?.trim() || null,
    }));

    // 同じキーで来たら、前の結果をそのまま返す。2回作らない。
    const existing = await findRunByKey(c.env.DB, body.accountId, idempotencyKey);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        return c.json({
          success: false,
          error: '同じ再送キーが別の内容に使われています。',
          code: 'IDEMPOTENCY_CONFLICT',
        }, 409);
      }
      return c.json({
        success: true,
        data: {
          runId: existing.id,
          status: existing.status,
          createdCount: existing.created_count,
          items: await listCloneItems(c.env.DB, existing.id),
        },
      });
    }

    /*
      **足りない機能があるまま作らせない**（要件 §7-3-1）。
      作ってから「使えません」と言われるより、作る前に断るほうがよい。
    */
    const features = await readFeatures(c.env.DB, body.accountId);
    const missing = missingFeatures(parseFeatures(recipe), features);
    if (missing.length > 0) {
      return c.json(
        { success: false, error: `${missing.join('と')}がオフです。機能設定でオンにしてください`, missingFeatures: missing },
        422,
      );
    }

    /*
      **内訳が決まっていないレシピは作れない。** 何ができるか言えないものを
      作ると、運用者はあとから何を消せばよいか分からない。
    */
    const items = parseItems(recipe);
    if (!items || items.length === 0) {
      return c.json(
        { success: false, error: '作られるものの内訳が、まだ決まっていません' },
        422,
      );
    }
    if (recipe.item_count !== null && recipe.item_count !== items.length) {
      return c.json({
        success: false,
        error: '作られるものの内訳が、まだ全部そろっていません',
        code: 'RECIPE_ITEMS_INCOMPLETE',
      }, 422);
    }

    const prepared = prepareItems(items, body.namePrefix);
    if (!prepared.ok) {
      return c.json({
        success: false,
        error: 'このレシピには、まだ複製できない種類が含まれています',
        code: 'UNSUPPORTED_RECIPE_ITEM',
        unsupportedKinds: prepared.unsupported,
      }, 422);
    }
    const missingPermissions = missingEditPermissions(c.get('staff'), prepared.items);
    if (missingPermissions.length > 0) {
      return c.json({
        success: false,
        error: 'このレシピを複製する権限がありません',
        code: 'FORBIDDEN',
        missingPermissions,
      }, 403);
    }
    const nameConflicts = await findNameConflicts(c.env.DB, body.accountId, prepared.items);
    if (nameConflicts.length > 0) {
      return c.json({
        success: false,
        error: '同じ名前の下書きがあります。名前のあたまを変えてください。',
        code: 'NAME_CONFLICT',
        conflicts: nameConflicts,
      }, 409);
    }

    let run;
    try {
      run = await startCloneRun(c.env.DB, {
        recipe,
        lineAccountId: body.accountId,
        namePrefix: body.namePrefix ?? null,
        idempotencyKey,
        requestFingerprint: fingerprint,
        createdBy: c.get('staff')?.id ?? null,
      });
    } catch (error) {
      const concurrent = await findRunByKey(c.env.DB, body.accountId, idempotencyKey);
      if (!concurrent) throw error;
      if (concurrent.request_fingerprint !== fingerprint) {
        return c.json({ success: false, error: '同じ再送キーが別の内容に使われています。', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      }
      return c.json({ success: true, data: {
        runId: concurrent.id,
        status: concurrent.status,
        createdCount: concurrent.created_count,
        items: await listCloneItems(c.env.DB, concurrent.id),
      } });
    }

    try {
      await c.env.DB.batch(cloneStatements(
        c.env.DB,
        recipe,
        run.id,
        body.accountId,
        prepared.items,
      ));
      return c.json(
        {
          success: true,
          data: {
            runId: run.id,
            status: 'succeeded',
            createdCount: prepared.items.length,
            items: await listCloneItems(c.env.DB, run.id),
          },
        },
        202,
      );
    } catch (err) {
      console.error('recipe clone failed:', err);
      await finishCloneRun(c.env.DB, run.id, {
        status: 'rolled_back',
        createdCount: 0,
        failureReason: 'CLONE_TRANSACTION_FAILED',
      });
      return c.json({
        success: false,
        error: '作れませんでした。何も作られていません',
        code: 'CLONE_TRANSACTION_FAILED',
        runId: run.id,
      }, 500);
    }
  } catch (err) {
    console.error('POST /api/recipes/:id/clone error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

recipes.get('/api/recipes/clone-runs/:runId', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const run = await getCloneRun(c.env.DB, c.req.param('runId'));
    if (!run) return c.json({ success: false, error: 'Not found' }, 404);
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [run.line_account_id]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    return c.json({
      success: true,
      data: {
        runId: run.id,
        recipeId: run.recipe_id,
        recipeVersion: run.recipe_version,
        accountId: run.line_account_id,
        namePrefix: run.name_prefix,
        status: run.status,
        createdCount: run.created_count,
        failureReason: run.failure_reason,
        createdAt: run.created_at,
        finishedAt: run.finished_at,
        items: await listCloneItems(c.env.DB, run.id),
      },
    });
  } catch (err) {
    console.error('GET /api/recipes/clone-runs/:runId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { recipes };
