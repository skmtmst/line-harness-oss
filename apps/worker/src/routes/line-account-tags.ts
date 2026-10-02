import { Hono, type Context } from 'hono';
import {
  createLineAccountTag, deleteLineAccountTag, getLineAccountTag, getLineAccountById,
  getLineAccountTagsByAccountIds, listLineAccountTags, replaceLineAccountTags,
  serializeLineAccountTag, updateLineAccountTag,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { denyReadOnly, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';

export const lineAccountTags = new Hono<Env>();
const tenantOf = (c: Context<Env>) => c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
function readInput(body: unknown, creating: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const input: { name?: string; color?: string | null; displayOrder?: number } = {};
  if (creating || 'name' in b) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 100) return null;
    input.name = b.name.trim();
  }
  if ('color' in b) {
    if (b.color !== null && (typeof b.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.color))) return null;
    input.color = b.color as string | null;
  }
  if ('displayOrder' in b) {
    if (!Number.isSafeInteger(b.displayOrder) || (b.displayOrder as number) < 0) return null;
    input.displayOrder = b.displayOrder as number;
  }
  return Object.keys(input).length ? input : null;
}
lineAccountTags.onError((error, c) => {
  if (error.message.includes('UNIQUE constraint failed: line_account_tags.tenant_id, line_account_tags.name')) {
    return c.json({ success: false, error: '同じ名前のアカウントタグがあります' }, 409);
  }
  // DB例外には入力値が含まれる場合があるため、本文を記録・返却しない。
  return c.json({ success: false, error: 'アカウントタグを保存・取得できませんでした' }, 500);
});
lineAccountTags.get('/api/line-account-tags', requireRole('owner', 'admin'), denyReadOnly(), async c => {
  return c.json({ success: true, data: (await listLineAccountTags(c.env.DB, tenantOf(c))).map(serializeLineAccountTag) });
});
lineAccountTags.post('/api/line-account-tags', requireRole('owner', 'admin'), denyReadOnly(), async c => {
  const input = readInput(await c.req.json().catch(() => null), true);
  if (!input?.name) return c.json({ success: false, error: 'タグの名前・色・並び順を確認してください' }, 400);
  const tag = await createLineAccountTag(c.env.DB, tenantOf(c), { ...input, name: input.name });
  auditLog(c, 'line_account_tag.create', { kind: 'line_account_tag', id: tag.id });
  return c.json({ success: true, data: serializeLineAccountTag(tag) }, 201);
});
lineAccountTags.patch('/api/line-account-tags/:id', requireRole('owner', 'admin'), denyReadOnly(), async c => {
  const id = c.req.param('id');
  if (!await getLineAccountTag(c.env.DB, tenantOf(c), id)) return c.json({ success: false, error: 'タグが見つかりません' }, 404);
  const input = readInput(await c.req.json().catch(() => null), false);
  if (!input) return c.json({ success: false, error: 'タグの名前・色・並び順を確認してください' }, 400);
  const tag = await updateLineAccountTag(c.env.DB, tenantOf(c), id, input);
  if (!tag) return c.json({ success: false, error: 'タグが見つかりません' }, 404);
  auditLog(c, 'line_account_tag.update', { kind: 'line_account_tag', id: id });
  return c.json({ success: true, data: serializeLineAccountTag(tag) });
});
lineAccountTags.delete('/api/line-account-tags/:id', requireRole('owner', 'admin'), denyReadOnly(), async c => {
  const id = c.req.param('id');
  if (!await getLineAccountTag(c.env.DB, tenantOf(c), id)) return c.json({ success: false, error: 'タグが見つかりません' }, 404);
  await deleteLineAccountTag(c.env.DB, tenantOf(c), id);
  auditLog(c, 'line_account_tag.delete', { kind: 'line_account_tag', id: id });
  return c.json({ success: true, data: { id } });
});
lineAccountTags.put('/api/line-accounts/:id/tags', requireRole('owner', 'admin'), denyReadOnly(), async c => {
  const id = c.req.param('id');
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])) return c.json({ success: false, error: 'アカウントが見つかりません' }, 404);
  const account = await getLineAccountById(c.env.DB, id);
  if (!account) return c.json({ success: false, error: 'アカウントが見つかりません' }, 404);
  if (account.archived_at) return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
  const body = await c.req.json<{ tagIds?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.tagIds) || body.tagIds.length > 100 || !body.tagIds.every(id => typeof id === 'string' && id.length > 0)) {
    return c.json({ success: false, error: 'tagIds にタグIDの配列を指定してください' }, 400);
  }
  const ids = [...new Set(body.tagIds as string[])];
  const tenantId = tenantOf(c);
  const available = new Set((await listLineAccountTags(c.env.DB, tenantId)).map(tag => tag.id));
  if (ids.some(id => !available.has(id))) return c.json({ success: false, error: '同じ統括のタグを選んでください' }, 400);
  if (!await replaceLineAccountTags(c.env.DB, tenantId, id, ids)) return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
  auditLog(c, 'line_account_tag.replace', { kind: 'line_account', id }, { lineAccountId: id });
  const tags = (await getLineAccountTagsByAccountIds(c.env.DB, tenantId, [id]))[id] ?? [];
  return c.json({ success: true, data: { id, tags } });
});
