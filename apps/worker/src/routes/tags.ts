import { Hono } from 'hono';
import {
  getTags,
  getTagsWithUsage,
  getTagDeleteImpact,
  createTag,
  deleteTag,
  updateTagMileageSettings,
  enqueueHistoricTagMileage,
  getTagGroups,
  createTagGroup,
  updateTagGroup,
  deleteTagGroup,
  assignTagToGroup,
  updateTag,
  reorderTags,
} from '@line-crm/db';
import type { Tag as DbTag, TagGroup as DbTagGroup, TagWithUsage } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const tags = new Hono<Env>();

/**
 * 色を持たないタグ・色を付けていないフォルダのタグに出す灰色。
 *
 * 画面側の `--color-ink-faint` と同じ値。ここで確定した色を返さないと、
 * 受け取る側それぞれで「色が無いときどうするか」を決めることになり、
 * 画面ごとに違う灰色が出る。
 */
const TAG_NEUTRAL_COLOR = '#8b938d';

function serializeTag(row: DbTag & Partial<TagWithUsage>) {
  return {
    id: row.id,
    name: row.name,
    /*
     * 印の色は「属するフォルダの色」。tags.color は 115 以前の名残で、
     * 読まない（画面からも書かない）。フォルダを JOIN していない読み方
     * （作成・更新の戻り）では undefined になるので、そのときは灰色。
     * 一覧を読み直した時点で正しい色に入れ替わる。
     */
    color: row.folder_color ?? TAG_NEUTRAL_COLOR,
    // 099以降はfoldersが正本。group_idは旧tag_groups時代の互換列で、
    // 新しい分類操作では更新されないため参照しない。
    groupId: row.folder_id ?? null,
    mileageReward: Number(row.mileage_reward ?? 0),
    referralMileageReward: Number(row.referral_mileage_reward ?? 0),
    mileageMultiplierBps: row.mileage_multiplier_bps == null
      ? null
      : Number(row.mileage_multiplier_bps),
    mileageMultiplierPriority: Number(row.mileage_multiplier_priority ?? 0),
    // 友だち一覧の「★つきタグ」列に出すか。列が無い環境でも 0 として返す。
    isStarred: Number(row.is_starred ?? 0) === 1,
    displayOrder: Number(row.display_order ?? 0),
    createdAt: row.created_at,
    ...(row.friend_count !== undefined ? { friendCount: row.friend_count } : {}),
    ...(row.assign_source ? { assignSource: row.assign_source } : {}),
    ...((row.used_in_broadcasts ?? 0) > 0
      || (row.used_in_forms ?? 0) > 0
      || (row.used_in_scenarios ?? 0) > 0
      || (row.used_in_auto_replies ?? 0) > 0
      || (row.used_in_saved_searches ?? 0) > 0
      ? {
          usedIn: {
            ...((row.used_in_broadcasts ?? 0) > 0
              ? { broadcasts: Number(row.used_in_broadcasts) } : {}),
            ...((row.used_in_forms ?? 0) > 0
              ? { forms: Number(row.used_in_forms) } : {}),
            ...((row.used_in_scenarios ?? 0) > 0
              ? { scenarios: Number(row.used_in_scenarios) } : {}),
            ...((row.used_in_auto_replies ?? 0) > 0
              ? { autoReplies: Number(row.used_in_auto_replies) } : {}),
            ...((row.used_in_saved_searches ?? 0) > 0
              ? { savedSearches: Number(row.used_in_saved_searches) } : {}),
          },
        }
      : {}),
    ...((row.other_action_count ?? 0) > 0
      ? { otherActionCount: Number(row.other_action_count) }
      : {}),
    ...(row.cleanup_reasons !== undefined
      ? { cleanupReasons: row.cleanup_reasons }
      : {}),
  };
}

function serializeTagGroup(row: DbTagGroup) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order ?? 0),
    // 色はフォルダに付く。属するタグの印にこの色を出す。
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 色は #RRGGBB だけ。名前付きの色を混ぜると画面での見た目が揃わない。 */
const GROUP_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// --- タグの親分類 ---------------------------------------------------------
//
// 分類そのものの読み書き。個々のタグの所属は PATCH /api/tags/:id/group で扱う。
// 経路を /api/tag-groups にしているのは、/api/tags/:id と衝突させないため
// （Hono は先に登録した方が勝つので、/api/tags/groups だと :id に食われる）。

// GET /api/tag-groups
tags.get('/api/tag-groups', async (c) => {
  try {
    const items = await getTagGroups(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTagGroup) });
  } catch (err) {
    console.error('GET /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tag-groups
tags.post('/api/tag-groups', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown; color?: unknown }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'name is required' }, 400);
    let color: string | null = null;
    if (body.color !== undefined && body.color !== null && body.color !== '') {
      const raw = String(body.color);
      if (!GROUP_COLOR_PATTERN.test(raw)) {
        return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
      }
      color = raw;
    }
    if (name.length > 60) {
      return c.json({ success: false, error: 'name must be 60 characters or fewer' }, 400);
    }
    const sortOrder = body.sortOrder === undefined ? 0 : Number(body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
      return c.json(
        { success: false, error: 'sortOrder must be an integer between 0 and 10000' },
        400,
      );
    }
    const group = await createTagGroup(c.env.DB, { name, sortOrder, color });
    return c.json({ success: true, data: serializeTagGroup(group) }, 201);
  } catch (err) {
    console.error('POST /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tag-groups/:id
tags.patch('/api/tag-groups/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown; color?: unknown }>();
    const patch: { name?: string; sortOrder?: number; color?: string | null } = {};
    if ('color' in body) {
      const raw = body.color;
      if (raw === null || raw === '') {
        patch.color = null;
      } else {
        const value = String(raw);
        if (!GROUP_COLOR_PATTERN.test(value)) {
          return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
        }
        patch.color = value;
      }
    }
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      if (name.length > 60) {
        return c.json({ success: false, error: 'name must be 60 characters or fewer' }, 400);
      }
      patch.name = name;
    }
    if (body.sortOrder !== undefined) {
      const sortOrder = Number(body.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
        return c.json(
          { success: false, error: 'sortOrder must be an integer between 0 and 10000' },
          400,
        );
      }
      patch.sortOrder = sortOrder;
    }
    const group = await updateTagGroup(c.env.DB, c.req.param('id'), patch);
    if (!group) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeTagGroup(group) });
  } catch (err) {
    console.error('PATCH /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tag-groups/:id
// 属していたタグは消えず「未分類」に戻る（tags.folder_id は ON DELETE SET NULL）。
tags.delete('/api/tag-groups/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteTagGroup(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id/group - move one tag into a group (null = 未分類)
tags.patch('/api/tags/:id/group', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ groupId?: unknown }>();
    const raw = body.groupId;
    const groupId = raw === null || raw === '' || raw === undefined ? null : String(raw);
    const tag = await assignTagToGroup(c.env.DB, c.req.param('id'), groupId);
    if (!tag) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeTag(tag) });
  } catch (err) {
    // 存在しない分類を指定した場合。500 にすると原因が分からない。
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json({ success: false, error: 'group not found' }, 400);
    }
    console.error('PATCH /api/tags/:id/group error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags - list all tags
// ?withCounts=1 adds friendCount and usage aggregates — admin UI only, so
// the many picker/filter consumers keep the cheap plain SELECT.
tags.get('/api/tags', async (c) => {
  try {
    const withCounts = c.req.query('withCounts') === '1';
    const items = withCounts
      ? await getTagsWithUsage(c.env.DB)
      : await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags/:id/delete-impact - 削除前に失われる付与と設定を確認する
tags.get(
  '/api/tags/:id/delete-impact',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const impact = await getTagDeleteImpact(c.env.DB, c.req.param('id'));
      if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
      return c.json({ success: true, data: impact });
    } catch (err) {
      console.error('GET /api/tags/:id/delete-impact error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

/**
 * PATCH /api/tags/reorder — 並び順をまとめて書く。
 *
 * 経路が /api/tags/:id より前にあるのは、:id に "reorder" として
 * 食われないようにするため。/api/tag-groups を分けているのと同じ理由。
 */
tags.patch('/api/tags/reorder', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ ids?: unknown }>();
    if (!Array.isArray(body.ids) || body.ids.some((v) => typeof v !== 'string')) {
      return c.json({ success: false, error: 'ids must be an array of tag ids' }, 400);
    }
    // 画面に出ている数より極端に多い並びは受けない。取り違えか壊れた要求。
    if (body.ids.length > 500) {
      return c.json({ success: false, error: 'too many ids' }, 400);
    }
    if (new Set(body.ids).size !== body.ids.length) {
      return c.json({ success: false, error: 'ids must not contain duplicates' }, 400);
    }
    await reorderTags(c.env.DB, body.ids as string[]);
    return c.json({ success: true, data: { updated: body.ids.length } });
  } catch (err) {
    console.error('PATCH /api/tags/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * PATCH /api/tags/:id — 名前と色を変える。
 *
 * 一覧の表からマイルの列を外して編集画面へ移したときに要るようになった。
 * それまでは作るときにしか決められず、打ち間違えたタグは消して作り直す
 * しかなかった。作り直すと、付いていた友だちの分がすべて外れる。
 *
 * 分類の付け替えは /group、マイルは /mileage が持っている。ここでは
 * 触らない。
 */
tags.patch('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; color?: unknown; isStarred?: unknown }>();
    const patch: { name?: string; color?: string; isStarred?: boolean } = {};

    if (body.isStarred !== undefined) {
      patch.isStarred = body.isStarred === true || body.isStarred === 1;
    }

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      patch.name = name;
    }
    if (body.color !== undefined) {
      const color = typeof body.color === 'string' ? body.color.trim() : '';
      // 画面の色見本と自由入力の両方から来る。形だけ見て通す。
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return c.json({ success: false, error: 'color must be #RRGGBB' }, 400);
      }
      patch.color = color;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ success: false, error: 'name, color or isStarred is required' }, 400);
    }

    const tag = await updateTag(c.env.DB, c.req.param('id'), patch);
    if (!tag) return c.json({ success: false, error: 'tag not found' }, 404);
    return c.json({ success: true, data: serializeTag(tag) });
  } catch (err) {
    // tags.name は UNIQUE。重複は 500 ではなく 409 で返す。
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    console.error('PATCH /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id/mileage - configure a one-time tag reward and/or tier multiplier.
tags.patch('/api/tags/:id/mileage', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      rewardMiles?: unknown;
      referralRewardMiles?: unknown;
      multiplierBps?: unknown;
      multiplierPriority?: unknown;
      applyToExisting?: unknown;
    }>();
    const rewardMiles = Number(body.rewardMiles ?? 0);
    const referralRewardMiles = Number(body.referralRewardMiles ?? 0);
    const multiplierBps = body.multiplierBps === null || body.multiplierBps === ''
      ? null
      : Number(body.multiplierBps);
    const multiplierPriority = Number(body.multiplierPriority ?? 0);
    const applyToExisting = body.applyToExisting === true;
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0 || rewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'rewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0 || referralRewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'referralRewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (multiplierBps !== null && (
      !Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000
    )) {
      return c.json({ success: false, error: 'multiplierBps must be null or an integer between 1000 and 100000' }, 400);
    }
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0 || multiplierPriority > 1000) {
      return c.json({ success: false, error: 'multiplierPriority must be an integer between 0 and 1000' }, 400);
    }

    const tag = await updateTagMileageSettings(c.env.DB, c.req.param('id'), {
      rewardMiles,
      referralRewardMiles,
      multiplierBps,
      multiplierPriority,
    });
    if (!tag) return c.json({ success: false, error: 'Not found' }, 404);
    // 保存しただけで既存ユーザーへ付与しない。運用中アカウントでは影響が
    // 大きいため、画面で遡及を明示したときだけキューへ積む。
    const queued = applyToExisting && (rewardMiles > 0 || referralRewardMiles > 0)
      ? await enqueueHistoricTagMileage(c.env.DB, tag.id)
      : 0;
    return c.json({ success: true, data: { tag: serializeTag(tag), queued } });
  } catch (err) {
    console.error('PATCH /api/tags/:id/mileage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; color?: string; groupId?: unknown }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name,
      color: body.color,
      groupId:
        body.groupId === null || body.groupId === '' || body.groupId === undefined
          ? null
          : String(body.groupId),
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    // tags.name has a UNIQUE constraint — surface duplicates as 409, not 500
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json({ success: false, error: 'group not found' }, 400);
    }
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
// friend_tags rows cascade via FK (ON DELETE CASCADE), but affiliate_offers.tag_id
// references tags without a cascade — D1 enforces it, so surface that as 409.
tags.delete('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json(
        { success: false, error: 'tag is referenced by other records (e.g. affiliate offers)' },
        409,
      );
    }
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
