import { Hono } from 'hono';
import { getLineAccounts, getFriendByLineUserIdForAccount, isLineAccountTenantActive } from '@line-crm/db';
import type { Env } from '../index.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { ensureResearchForm } from '../services/research-forms.js';

const research = new Hono<Env>();
research.get('/api/liff/research/:id/form', async c => {
  const account = (await getLineAccounts(c.env.DB)).find(row => row.is_active === 1 && row.archived_at === null && row.liff_id === c.req.query('liffId'));
  if (!account) return c.json({ success: false, error: '回答画面が見つかりませんでした' }, 404);
  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env, account.id);
  if (!identity?.lineAccountId || identity.lineAccountId !== account.id) return c.json({ success: false, error: 'LINEでログインしてください' }, 401);
  if (!await isLineAccountTenantActive(c.env.DB, identity.lineAccountId)) return c.json({ success: false, error: '現在ご利用いただけません' }, 503);
  const friend = await getFriendByLineUserIdForAccount(c.env.DB, identity.lineUserId, identity.lineAccountId);
  if (!friend || friend.is_following === 0) return c.json({ success: false, error: '友だち追加後に回答してください' }, 403);
  try {
    const formId = await ensureResearchForm(c.env.DB, c.req.param('id'), identity.lineAccountId);
    return c.json({ success: true, data: { formId } });
  } catch (error) {
    if (error instanceof Error && error.message === 'RESEARCH_NOT_FOUND') return c.json({ success: false, error: 'リサーチが見つかりませんでした' }, 404);
    console.error('research form preparation failed', error);
    return c.json({ success: false, error: '回答画面を準備できませんでした。もう一度読み込んでください' }, 422);
  }
});
export { research };
