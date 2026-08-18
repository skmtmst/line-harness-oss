import { Hono } from 'hono';
import {
  getTags,
  getTagsWithCounts,
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
} from '@line-crm/db';
import type { Tag as DbTag, TagGroup as DbTagGroup } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag & { friend_count?: number }) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
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
    createdAt: row.created_at,
    ...(row.friend_count !== undefined ? { friendCount: row.friend_count } : {}),
  };
}

function serializeTagGroup(row: DbTagGroup) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'name is required' }, 400);
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
    const group = await createTagGroup(c.env.DB, { name, sortOrder });
    return c.json({ success: true, data: serializeTagGroup(group) }, 201);
  } catch (err) {
    console.error('POST /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tag-groups/:id
tags.patch('/api/tag-groups/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown }>();
    const patch: { name?: string; sortOrder?: number } = {};
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
// ?withCounts=1 adds friendCount (JOIN over friend_tags) — admin UI only, so
// the many picker/filter consumers keep the cheap plain SELECT.
tags.get('/api/tags', async (c) => {
  try {
    const withCounts = c.req.query('withCounts') === '1';
    const items = withCounts
      ? await getTagsWithCounts(c.env.DB)
      : await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
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
    }>();
    const rewardMiles = Number(body.rewardMiles ?? 0);
    const referralRewardMiles = Number(body.referralRewardMiles ?? 0);
    const multiplierBps = body.multiplierBps === null || body.multiplierBps === ''
      ? null
      : Number(body.multiplierBps);
    const multiplierPriority = Number(body.multiplierPriority ?? 0);
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
    const queued = rewardMiles > 0 || referralRewardMiles > 0
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
