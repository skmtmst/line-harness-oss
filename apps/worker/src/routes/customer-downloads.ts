import { Hono, type MiddlewareHandler } from 'hono';
import { activeTenantLineAccountSql } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { CHAT_ATTACHMENT_ID, CHAT_ATTACHMENT_PREFIX, ChatAttachmentError, ownedAttachment } from '../services/chat-attachments.js';
import { customerFileOwner } from '../services/customer-file-access.js';
import { customerLiffDownload, privateDownloadHeaders } from '../services/download-entrypoints.js';
import { signDownload } from '../services/download-capability.js';

const customerDownloads = new Hono<Env>();
const privateResponse: MiddlewareHandler<Env> = async (c, next) => {
  for (const [key, value] of Object.entries(privateDownloadHeaders)) c.header(key, value);
  await next();
};
customerDownloads.use('/api/liff/files/*', privateResponse);
customerDownloads.use('/liff/*', privateResponse);

customerDownloads.get('/api/liff/files/:id/download', async c => {
  if (!/^Bearer \S+$/.test(c.req.header('Authorization') ?? '')) {
    return c.json({ success: false, code: 'LINE_AUTH_REQUIRED', error: 'LINEでログインして、もう一度お試しください' }, 401);
  }
  const id = c.req.param('id');
  if (!CHAT_ATTACHMENT_ID.test(id)) return c.json({ success: false, code: 'DOWNLOAD_UNAVAILABLE', error: 'このファイルは利用できません。お店へお問い合わせください' }, 404);
  try {
    const object = await c.env.IMAGES.head(`${CHAT_ATTACHMENT_PREFIX}${id}`);
    const owner = object ? await customerFileOwner(c, object) : null;
    if (!owner) {
      return c.json({ success: false, code: 'DOWNLOAD_UNAVAILABLE', error: 'このファイルは利用できません。お店へお問い合わせください' }, 404);
    }
    const origin = c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin;
    const file = await ownedAttachment(c.env.IMAGES, id, owner, origin);
    if (file.expiresAt && (!Number.isFinite(Date.parse(file.expiresAt)) || Date.parse(file.expiresAt) <= Date.now())) throw new ChatAttachmentError('期限切れ');
    if (!c.env.API_KEY) return c.json({ success: false, code: 'DOWNLOAD_UNCONFIGURED', error: 'ただいま取得できません。お店へお問い合わせください' }, 503);
    const url = await signDownload(new URL(file.url), c.env.API_KEY, 'chat-attachment-self', id,
      JSON.stringify([owner.lineAccountId, owner.friendId]), file.expiresAt ? Date.parse(file.expiresAt) : undefined);
    return c.json({ success: true, data: { id, url,
      expiresAt: new Date(Number(new URL(url).searchParams.get('expires')) * 1000).toISOString(),
      filename: file.filename, mimeType: file.mimeType, size: file.size, kind: file.kind,
    } });
  } catch (error) {
    if (error instanceof ChatAttachmentError) return c.json({ success: false, code: 'DOWNLOAD_UNAVAILABLE', error: 'このファイルは利用できません。お店へお問い合わせください' }, 404);
    return c.json({ success: false, code: 'DOWNLOAD_RETRY', error: '取得できませんでした。時間をおいて、もう一度お試しください' }, 502);
  }
});

// Public compatibility gateways disclose no filenames, owners, or file bytes.
customerDownloads.get('/liff/:kind/:id', async c => {
  const kind = c.req.param('kind');
  const id = c.req.param('id');
  if (!['files', 'statements'].includes(kind) || id.length > 200 || !/^[\w-]+$/.test(id)) return c.notFound();
  let accountId: string | undefined;
  if (kind === 'files' && CHAT_ATTACHMENT_ID.test(id)) {
    const object = await c.env.IMAGES.head(`${CHAT_ATTACHMENT_PREFIX}${id}`);
    accountId = object?.customMetadata?.lineAccountId;
  } else if (kind === 'statements') {
    const statement = await c.env.DB.prepare('SELECT line_account_id FROM affiliate_statements WHERE id = ?')
      .bind(id).first<{ line_account_id: string }>();
    accountId = statement?.line_account_id;
  }
  const account = accountId ? await c.env.DB.prepare(`SELECT a.liff_id FROM line_accounts a
    WHERE a.id = ? AND a.is_active = 1 AND a.archived_at IS NULL AND ${activeTenantLineAccountSql('a.id')}`)
    .bind(accountId).first<{ liff_id: string | null }>() : null;
  const url = customerLiffDownload(account?.liff_id, kind as 'files' | 'statements', id);
  if (url) return c.redirect(url, 303);
  return c.html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>ファイルの取り直し</title><p>LINEでの本人確認が必要です。このリンクを利用できない場合は、お店へお問い合わせください。</p></html>', 410);
});

export { customerDownloads };
