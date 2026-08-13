import { getLineAccountById, jstNow } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

type RichMenuEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  NEN_EC_BASE_URL?: string;
  NEN_RICH_MENU_STORE_URL?: string;
};

export async function installNenRichMenu(env: RichMenuEnv, accountId: string) {
  const account = await getLineAccountById(env.DB, accountId);
  if (!account) throw new Error('LINE account not found');
  const liffId = (account as unknown as { liff_id?: string | null }).liff_id;
  if (!liffId) throw new Error('LIFF ID is not configured');

  const base = `https://liff.line.me/${encodeURIComponent(liffId)}/?page=nen-member&liffId=${encodeURIComponent(liffId)}`;
  // 2500pxは3等分できないため、1pxの押せない隙間が生まれない整数境界にする。
  const columns = [
    { x: 0, width: 834 },
    { x: 834, width: 833 },
    { x: 1667, width: 833 },
  ];
  const tabs = ['home', 'pets', 'health', 'orders', 'photos'];
  const labels = ['ホーム', 'マイペット', '健康日記', '注文・定期', '投稿'];
  const areas = Array.from({ length: 6 }, (_, index) => ({
    bounds: {
      x: columns[index % 3].x,
      y: Math.floor(index / 3) * 843,
      width: columns[index % 3].width,
      height: 843,
    },
    action: index < 5
      ? { type: 'uri' as const, label: labels[index], uri: `${base}&tab=${tabs[index]}` }
      : {
          type: 'uri' as const,
          label: '商品を見る',
          uri: `${env.NEN_RICH_MENU_STORE_URL || env.NEN_EC_BASE_URL || 'https://nen-petfood.com'}/products/list`,
        },
  }));

  const client = new LineClient(account.channel_access_token);
  const created = await client.createRichMenu({
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'NEN会員メニュー v2',
    chatBarText: 'NENメニュー',
    areas,
  });
  const richMenuId = created.richMenuId;
  try {
    const image = await env.ASSETS.fetch(new Request('https://assets.local/assets/nen/rich-menu-v2.jpg'));
    if (!image.ok) throw new Error(`menu image not found: ${image.status}`);
    await client.uploadRichMenuImage(richMenuId, await image.arrayBuffer(), 'image/jpeg');
    await client.setDefaultRichMenu(richMenuId);
    return { richMenuId, liffId };
  } catch (error) {
    await client.deleteRichMenu(richMenuId).catch(() => undefined);
    throw error;
  }
}

export async function processPendingNenRichMenuJobs(env: RichMenuEnv) {
  const job = await env.DB.prepare(
    `SELECT id, line_account_id, attempts FROM nen_rich_menu_jobs
      WHERE status = 'pending' ORDER BY created_at LIMIT 1`,
  ).first<{ id: string; line_account_id: string; attempts: number }>();
  if (!job) return { processed: 0 };

  const claimed = await env.DB.prepare(
    `UPDATE nen_rich_menu_jobs
        SET status='processing', attempts=attempts+1, updated_at=?
      WHERE id=? AND status='pending'`,
  ).bind(jstNow(), job.id).run();
  if (!claimed.meta.changes) return { processed: 0 };

  try {
    const result = await installNenRichMenu(env, job.line_account_id);
    await env.DB.prepare(
      `UPDATE nen_rich_menu_jobs
          SET status='completed', rich_menu_id=?, last_error=NULL, completed_at=?, updated_at=?
        WHERE id=?`,
    ).bind(result.richMenuId, jstNow(), jstNow(), job.id).run();
    return { processed: 1, status: 'completed', ...result };
  } catch (error) {
    const attempts = job.attempts + 1;
    await env.DB.prepare(
      `UPDATE nen_rich_menu_jobs
          SET status=?, last_error=?, updated_at=?
        WHERE id=?`,
    ).bind(attempts < 3 ? 'pending' : 'failed', String(error).slice(0, 1000), jstNow(), job.id).run();
    throw error;
  }
}
