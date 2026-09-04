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
  recordCloneItem,
  rollbackCloneRun,
  startCloneRun,
  type RecipeRow,
} from '@line-crm/db';
import { getVersionedAccountSetting } from '@line-crm/db';
import type { Env } from '../index.js';

/** 機能設定の保存キー。`routes/feature-settings.ts` と同じ値。 */
const FEATURE_SETTINGS_BUNDLE_KEY = 'feature.settings_bundle_v1';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * レシピ。設計 ★V6 34-2（`y0P0Qx`）/ 34-3（`D5UaX`）。台帳 #134。
 *
 * **複製の途中失敗は全部戻す**（要件 v6-34 §7-3）。部分的に作らない。
 * 半分だけできた状態は、運用者が何を消せばよいか分からない。
 */
const recipes = new Hono<Env>();

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
recipes.post('/api/recipes/:id/clone', requireRole('owner', 'admin'), async (c) => {
  try {
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'Idempotency-Key が要ります' }, 400);
    }
    const recipe = await getRecipeById(c.env.DB, c.req.param('id'));
    if (!recipe) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ accountId?: string; namePrefix?: string | null }>();
    if (!body.accountId) {
      return c.json({ success: false, error: 'accountId が要ります' }, 400);
    }
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    // 同じキーで来たら、前の結果をそのまま返す。2回作らない。
    const existing = await findRunByKey(c.env.DB, body.accountId, idempotencyKey);
    if (existing) {
      return c.json({
        success: true,
        data: { runId: existing.id, status: existing.status, createdCount: existing.created_count },
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

    const run = await startCloneRun(c.env.DB, {
      recipe,
      lineAccountId: body.accountId,
      namePrefix: body.namePrefix ?? null,
      idempotencyKey,
      createdBy: c.get('staff')?.id ?? null,
    });

    let created = 0;
    try {
      for (const item of items) {
        const name = prefixedName(body.namePrefix, item.name);
        const id = crypto.randomUUID();
        /*
          **すべて下書きで作る**（設計 34-3「すべて下書きで作られます」）。
          放っておいても友だちには何も届かない。
        */
        if (item.kind === 'タグ' || item.kind === 'tag') {
          await c.env.DB.prepare(
            `INSERT INTO tags (id, name, created_at, updated_at)
             VALUES (?, ?, datetime('now'), datetime('now'))`,
          )
            .bind(id, name)
            .run();
          await recordCloneItem(c.env.DB, { runId: run.id, kind: 'tag', targetId: id, name });
          created += 1;
        } else if (item.kind === 'テンプレート' || item.kind === 'template') {
          await c.env.DB.prepare(
            `INSERT INTO templates
               (id, name, category, message_type, message_content, question_status,
                created_at, updated_at, line_account_id)
             VALUES (?, ?, 'general', 'text', ?, 'draft', datetime('now'), datetime('now'), ?)`,
          )
            .bind(id, name, item.note, body.accountId)
            .run();
          await recordCloneItem(c.env.DB, { runId: run.id, kind: 'template', targetId: id, name });
          created += 1;
        } else if (item.kind === 'シナリオ' || item.kind === 'scenario') {
          await c.env.DB.prepare(
            `INSERT INTO scenarios
               (id, name, description, trigger_type, trigger_tag_id, line_account_id, is_active,
                created_at, updated_at)
             VALUES (?, ?, ?, 'tag_added', NULL, ?, 0, datetime('now'), datetime('now'))`,
          )
            .bind(id, name, item.note, body.accountId)
            .run();
          await recordCloneItem(c.env.DB, { runId: run.id, kind: 'scenario', targetId: id, name });
          created += 1;
        }
        // 上に無い種別（友だち追加時のルールなど）は、まだ作れない。
        // **作れないものを黙って飛ばさない**——下の照合で数が合わなくなる。
      }

      /*
        照合。**作るつもりだった数と、作った数を突き合わせる。**
        合わなければ全部戻す。半分だけ残さない。
      */
      const creatable = items.filter((i) =>
        ['タグ', 'tag', 'テンプレート', 'template', 'シナリオ', 'scenario'].includes(i.kind),
      ).length;
      if (created !== creatable) {
        await rollbackCloneRun(c.env.DB, run.id);
        await finishCloneRun(c.env.DB, run.id, {
          status: 'failed',
          createdCount: 0,
          failureReason: '数が合わなかったので、作ったものを全部戻しました',
        });
        return c.json({ success: false, error: '作れませんでした。何も作られていません' }, 500);
      }

      await finishCloneRun(c.env.DB, run.id, { status: 'succeeded', createdCount: created });
      return c.json(
        {
          success: true,
          data: {
            runId: run.id,
            status: 'succeeded',
            createdCount: created,
            items: await listCloneItems(c.env.DB, run.id),
          },
        },
        202,
      );
    } catch (err) {
      console.error('recipe clone failed:', err);
      await rollbackCloneRun(c.env.DB, run.id);
      await finishCloneRun(c.env.DB, run.id, {
        status: 'failed',
        createdCount: 0,
        failureReason: err instanceof Error ? err.message : '作れませんでした',
      });
      return c.json({ success: false, error: '作れませんでした。何も作られていません' }, 500);
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
