import { folderInputError, inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';
import { HqFolderError, listHqBannerFolders, saveHqBannerFolder, deleteHqBannerFolder, swapHqFolderOrder } from '@line-crm/db';
import { DEFAULT_TENANT_ID, isFolderSelectColor, type HqBannerFolderKind } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HqFolderError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
function kind(value: unknown): HqBannerFolderKind {
  if (value !== 'project' && value !== 'image') throw new HqFolderError('INVALID_FOLDER_KIND');
  return value;
}
function revision(value: unknown, key = 'expectedRevision'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new FolderRevisionError(key);
  return value;
}
class FolderRevisionError extends Error {
  readonly code = 'INVALID_REVISION';
  readonly status = 422;
  constructor(readonly field: string) { super('INVALID_REVISION'); }
}
function input(value: Record<string, unknown>) {
  if (value.name !== undefined && typeof value.name !== 'string') throw new HqFolderError('INVALID_FOLDER_NAME');
  if (value.color !== undefined && !isFolderSelectColor(value.color)) throw new HqFolderError('INVALID_FOLDER_COLOR');
  return { name: value.name, color: value.color };
}
export const hqBannerFolders = new Hono<Env>();
hqBannerFolders.use('/api/hq/banners/*', requireRole('owner', 'admin'));
hqBannerFolders.onError((e, c) => {
  if (e instanceof FolderRevisionError) return inputError(c, { success: false, error: e.code }, e.status, [e.field]);
  if (e instanceof HqFolderError) return folderInputError(c, e);
  return c.json({ success: false, error: 'フォルダを保存できません' }, 500);
});
hqBannerFolders.use('*', async (c, next) => {
  if (c.get('staff')?.readOnly && !['GET', 'HEAD'].includes(c.req.method)) return c.json({ success: false, error: '閲覧のみです' }, 403);
  await next();
});
hqBannerFolders.get('/api/hq/banners/folders', async c => c.json({ success: true, data: await listHqBannerFolders(c.env.DB, c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID, kind(c.req.query('kind'))) }));
hqBannerFolders.post('/api/hq/banners/folders', inputJsonBoundary({kind:['string'],name:['string'],color:['string','null']}), async c => {
  const b = await body(c), values = input(b);
  if (typeof values.name !== 'string') throw new HqFolderError('INVALID_FOLDER_NAME');
  return c.json({ success: true, data: await saveHqBannerFolder(c.env.DB, c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID, kind(b.kind), values) }, 201);
});
hqBannerFolders.patch('/api/hq/banners/folders/:id', inputJsonBoundary({kind:['string'],name:['string'],color:['string','null'],expectedRevision:['number']}), async c => {
  const b = await body(c);
  return c.json({ success: true, data: await saveHqBannerFolder(c.env.DB, c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID, kind(b.kind), { ...input(b), expectedRevision: revision(b.expectedRevision) }, c.req.param('id')) });
});
hqBannerFolders.post('/api/hq/banners/folders/:id/swap-order', inputJsonBoundary({kind:['string'],withId:['string'],expectedRevision:['number'],withExpectedRevision:['number']}), async c => {
  const b = await body(c);
  if (typeof b.withId !== 'string') throw new HqFolderError('INVALID_FOLDER_ORDER');
  return c.json({ success: true, data: await swapHqFolderOrder(c.env.DB, 'hq_banner_folders', c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID, c.req.param('id'), { withId: b.withId, expectedRevision: revision(b.expectedRevision), withExpectedRevision: revision(b.withExpectedRevision, 'withExpectedRevision') }, kind(b.kind)) });
});
hqBannerFolders.delete('/api/hq/banners/folders/:id', async c => {
  const b = await body(c);
  return c.json({ success: true, data: await deleteHqBannerFolder(c.env.DB, c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID, kind(b.kind), c.req.param('id'), revision(b.expectedRevision)) });
});
