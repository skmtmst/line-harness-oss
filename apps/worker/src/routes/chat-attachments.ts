import { Hono, type Context } from 'hono';
import { getChatById, getFriendById, jstNow } from '@line-crm/db';
import { CHAT_FILE_TTL_MS, CHAT_IMAGE_MAX_BYTES, type ChatAttachment } from '@line-crm/shared';
import type { Env } from '../index.js';
import { denyReadOnly, requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { createR2PresignedPutUrl } from '../services/r2-presigned-upload.js';
import {
  attachmentFromObject, attachmentUrl, CHAT_ATTACHMENT_ID, CHAT_ATTACHMENT_PREFIX,
  CHAT_UPLOAD_PREFIX, ChatAttachmentError, metadataFor, ownedAttachment, uploadKind, validateChatUpload,
  type AttachmentOwner,
} from '../services/chat-attachments.js';

const chatAttachments = new Hono<Env>();
const guards = [requireRole('owner', 'admin', 'staff'), requirePermission('/chats'), denyReadOnly()] as const;
const contextKey = (id: string) => `private/chat-upload-context/${id}`;
const originOf = (c: Context<Env>) => c.env.WORKER_URL || new URL(c.req.url).origin;
async function target(c: Context<Env>): Promise<AttachmentOwner | null> {
  const chat = await getChatById(c.env.DB, c.req.param('id')!);
  const friend = await getFriendById(c.env.DB, chat?.friend_id ?? c.req.param('id')!);
  if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [friend.line_account_id])) return null;
  return { friendId: friend.id, lineAccountId: friend.line_account_id };
}
function newAttachment(c: Context<Env>, filename: string, mimeType: string, size: number): ChatAttachment {
  const kind = uploadKind(mimeType, filename, size);
  const id = crypto.randomUUID();
  return { id, key: `${CHAT_ATTACHMENT_PREFIX}${id}`, url: attachmentUrl(originOf(c), id), filename, mimeType, size, kind,
    expiresAt: kind === 'file' ? new Date(Date.now() + CHAT_FILE_TTL_MS).toISOString() : null };
}
async function readBounded(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > max) throw new ChatAttachmentError('ファイルは10MB以下にしてください');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

chatAttachments.post('/api/chats/:id/attachments/upload', ...guards, async c => {
  const owner = await target(c);
  if (!owner) return c.notFound();
  try {
    const mimeType = (c.req.header('Content-Type') ?? '').split(';')[0];
    const filename = decodeURIComponent(c.req.header('X-Filename') ?? '');
    const declaredSize = c.req.header('Content-Length');
    if (mimeType === 'video/mp4') return c.json({ success: false, error: '動画は直接アップロードの口を使ってください' }, 400);
    if (declaredSize && Number(declaredSize) > CHAT_IMAGE_MAX_BYTES) throw new ChatAttachmentError('ファイルは10MB以下にしてください');
    if (!c.req.raw.body) throw new ChatAttachmentError('ファイルを選んでください');
    const bytes = await readBounded(c.req.raw.body, CHAT_IMAGE_MAX_BYTES);
    if (declaredSize && Number(declaredSize) !== bytes.length) throw new ChatAttachmentError('申告した大きさとファイルが一致しません');
    const attachment = newAttachment(c, filename, mimeType, bytes.length);
    validateChatUpload(bytes, mimeType, filename);
    await c.env.IMAGES.put(attachment.key, bytes, {
      httpMetadata: { contentType: mimeType }, customMetadata: metadataFor(attachment, owner),
    });
    return c.json({ success: true, data: attachment }, 201);
  } catch (error) {
    if (error instanceof ChatAttachmentError || error instanceof URIError) return c.json({ success: false, error: error.message }, 400);
    return c.json({ success: false, error: '添付を保存できませんでした。もう一度選び直してください' }, 502);
  }
});

interface Session {
  id: string; line_account_id: string | null; created_by: string; r2_key: string;
  public_key: string | null; filename: string; mime_type: string; expected_size: number;
  expires_at: string; completed_at: string | null;
}
// API-6と同じ署名URL・既存のアップロード予約表・ETag照合・完了のCASを使う。
chatAttachments.post('/api/chats/:id/attachments/upload-sessions', ...guards, async c => {
  const owner = await target(c);
  if (!owner) return c.notFound();
  let body: { filename: string; mimeType: string; sizeBytes: number };
  try {
    body = await c.req.json();
    if (!body || typeof body.filename !== 'string' || body.mimeType !== 'video/mp4'
      || uploadKind(body.mimeType, body.filename, body.sizeBytes) !== 'video') throw new ChatAttachmentError('MP4動画を選んでください');
  } catch (error) { return c.json({ success: false, error: error instanceof ChatAttachmentError ? error.message : '形式を確認してください' }, 400); }
  if (!c.env.CF_ACCOUNT_ID || !c.env.MEDIA_R2_ACCESS_KEY_ID || !c.env.MEDIA_R2_SECRET_ACCESS_KEY || !c.env.MEDIA_R2_BUCKET_NAME) {
    return c.json({ success: false, error: '直接アップロードが未設定です。管理者に確認してください' }, 503);
  }
  const id = crypto.randomUUID();
  const key = `${CHAT_UPLOAD_PREFIX}${id}.mp4`;
  const signed = await createR2PresignedPutUrl({ accountId: c.env.CF_ACCOUNT_ID, accessKeyId: c.env.MEDIA_R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.MEDIA_R2_SECRET_ACCESS_KEY, bucketName: c.env.MEDIA_R2_BUCKET_NAME },
  { key, contentType: body.mimeType, lineAccountId: owner.lineAccountId ?? '', uploadSessionId: id });
  await c.env.IMAGES.put(contextKey(id), JSON.stringify(owner), { httpMetadata: { contentType: 'application/json' } });
  await c.env.DB.prepare(`INSERT INTO broadcast_media_upload_sessions
    (id,line_account_id,created_by,r2_key,filename,mime_type,expected_size,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, owner.lineAccountId, c.get('staff').id, key, body.filename, body.mimeType, body.sizeBytes, signed.expiresAt, jstNow()).run();
  return c.json({ success: true, data: { id, uploadUrl: signed.url, requiredHeaders: signed.headers, expiresAt: signed.expiresAt } }, 201);
});

chatAttachments.post('/api/chats/:id/attachments/upload-sessions/:sessionId/complete', ...guards, async c => {
  const owner = await target(c);
  if (!owner) return c.notFound();
  const id = c.req.param('sessionId');
  if (!CHAT_ATTACHMENT_ID.test(id)) return c.notFound();
  const session = await c.env.DB.prepare('SELECT * FROM broadcast_media_upload_sessions WHERE id = ? AND created_by = ?')
    .bind(id, c.get('staff').id).first<Session>();
  const context = await c.env.IMAGES.get(contextKey(id));
  const storedOwner = context ? await context.json<AttachmentOwner>() : null;
  if (!session || !session.r2_key.startsWith(CHAT_UPLOAD_PREFIX) || session.line_account_id !== owner.lineAccountId
    || storedOwner?.friendId !== owner.friendId || storedOwner?.lineAccountId !== owner.lineAccountId) return c.notFound();
  const replay = async (key: string) => ownedAttachment(c.env.IMAGES, key.slice(CHAT_ATTACHMENT_PREFIX.length), owner, originOf(c));
  if (session.completed_at && session.public_key) return c.json({ success: true, data: await replay(session.public_key) });
  if (Date.parse(session.expires_at) <= Date.now()) return c.json({ success: false, error: 'アップロード期限が切れました' }, 409);
  let body: { etag?: string };
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'ETagを確認してください' }, 400); }
  const object = await c.env.IMAGES.head(session.r2_key);
  if (!object || object.size !== session.expected_size || object.httpMetadata?.contentType !== session.mime_type
    || typeof body?.etag !== 'string' || object.etag !== body.etag.replace(/^"|"$/g, '')
    || object.customMetadata?.['upload-session-id'] !== session.id
    || object.customMetadata?.['line-account-id'] !== (session.line_account_id ?? '')) {
    return c.json({ success: false, error: 'アップロードしたファイルを確認できませんでした' }, 409);
  }
  const prefix = await c.env.IMAGES.get(session.r2_key, { range: { offset: 0, length: 256 * 1024 }, onlyIf: { etagMatches: object.etag } });
  if (!prefix || !('body' in prefix)) return c.json({ success: false, error: 'ファイルが変更されました' }, 409);
  try { validateChatUpload(new Uint8Array(await prefix.arrayBuffer()), session.mime_type, session.filename, session.expected_size); }
  catch (error) { return c.json({ success: false, error: error instanceof Error ? error.message : '形式を確認してください' }, 422); }
  const source = await c.env.IMAGES.get(session.r2_key, { onlyIf: { etagMatches: object.etag } });
  if (!source || !('body' in source)) return c.json({ success: false, error: 'ファイルが変更されました' }, 409);
  const attachment = newAttachment(c, session.filename, session.mime_type, session.expected_size);
  const fixed = new FixedLengthStream(session.expected_size);
  const abort = new AbortController();
  const pipe = source.body.pipeTo(fixed.writable, { signal: abort.signal });
  void pipe.catch(() => undefined);
  try {
    await c.env.IMAGES.put(attachment.key, fixed.readable, {
      httpMetadata: { contentType: session.mime_type }, customMetadata: metadataFor(attachment, owner),
    });
    await pipe;
  } catch {
    abort.abort();
    await pipe.catch(() => undefined);
    return c.json({ success: false, error: '添付を保存できませんでした' }, 502);
  }
  const completion = await c.env.DB.prepare('UPDATE broadcast_media_upload_sessions SET public_key = ?, completed_at = ? WHERE id = ? AND completed_at IS NULL')
    .bind(attachment.key, jstNow(), session.id).run();
  if (Number(completion.meta.changes) !== 1) {
    const winner = await c.env.DB.prepare('SELECT public_key FROM broadcast_media_upload_sessions WHERE id = ?').bind(id).first<{ public_key: string }>();
    await c.env.IMAGES.delete(attachment.key);
    if (!winner?.public_key) return c.json({ success: false, error: '完了を確認できませんでした' }, 409);
    return c.json({ success: true, data: await replay(winner.public_key) });
  }
  return c.json({ success: true, data: attachment }, 201);
});

// 決まったPNG（先頭のコマを作れないときのプレビュー）。R2への設定作業は不要。
chatAttachments.get('/images/chat-attachments/video-preview.png', c => {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAADbklEQVR4Ae3BsZXjVhYFwKt7GJNgCY4Q9rfgISptBtpRD5sE+1XVH3/+9fc/ARioARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqARiqgS+4zhX4dA180XWuwCdr4Ddc58p1rsAnauAJrnPlOlfgkzTwRNe5Ap+igSe7zpXrXIG7a+CbXOcK3FkD3+g6V65zBe6ogRe4zhW4mwZe5DpXrnMF7qKBF7vOFbiDBt7gOleucwXeqYE3us4VeJcG3uw6V65zBV6tgZu4zhV4pQZu5DpXrnMFXqGBG7rOletcge/UwI1d5wp8lwZu7jpXrnMFnq2BD3GdK/BMDXyQ61y5zhV4hgY+0HWuwO9q4ENd58p1rsBXNfDhrnMFvqKBH+A6V65zBf6LBn6Q61yBX9XAD3OdK9e5Av9PAz/Uda7Av2ngh9r2I/BvHoEfZtuPwK9o4AfZ9iPwqx6BH2Dbj8B/1cCH2/Yj8BWPwIfa9iPwOxr4QNt+BH7XI/BBtv0IPEsDH2Lbj8AzPQI3t+1H4Ds0cGPbfgS+yyNwQ9t+BL7bI3Aj234EXqWBm9j2I/BKj8CbbfsReIcG3mjbj8C7PAJvsO1H4N0aeLFtPwJ38Ai8yLYfgTtp4AW2/QjczSPwjbb9CNxVA99k24/AnT0CT7btR+ATNPBE234EPsUj8ATbfgQ+zSPwG7b9CHyqBr5o24/AJ/vjz7/+/icAAzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQzUAQ/0Pc+J4FpvBH3AAAAAASUVORK5CYII='), ch => ch.charCodeAt(0));
  return c.body(bytes, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
});
chatAttachments.get('/images/chat-attachments/:attachmentId', async c => {
  const id = c.req.param('attachmentId');
  if (!CHAT_ATTACHMENT_ID.test(id)) return c.notFound();
  const head = await c.env.IMAGES.head(`${CHAT_ATTACHMENT_PREFIX}${id}`);
  if (!head) return c.notFound();
  const attachment = attachmentFromObject(id, head, originOf(c));
  // no-storeをすべてのファイル応答に付け、期限後にキャッシュから返さない。
  const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (attachment.kind === 'file' && (!attachment.expiresAt || !Number.isFinite(Date.parse(attachment.expiresAt)) || Date.parse(attachment.expiresAt) <= Date.now())) {
    return c.json({ success: false, error: 'ダウンロード期限が切れました' }, 410, privateHeaders);
  }
  let range: { offset: number; length: number } | undefined;
  const requestedRange = c.req.header('Range');
  if (requestedRange) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(requestedRange);
    const start = match ? Number(match[1]) : -1;
    const end = match?.[2] ? Number(match[2]) : head.size - 1;
    if (start < 0 || start >= head.size || end < start) return c.body(null, 416, { ...privateHeaders, 'Content-Range': `bytes */${head.size}` });
    range = { offset: start, length: Math.min(end, head.size - 1) - start + 1 };
  }
  const object = await c.env.IMAGES.get(`${CHAT_ATTACHMENT_PREFIX}${id}`, range ? { range } : undefined);
  if (!object) return c.notFound();
  return new Response(object.body, { status: range ? 206 : 200, headers: {
    ...privateHeaders, 'Content-Type': attachment.mimeType, 'Accept-Ranges': 'bytes',
    'Content-Length': String(range?.length ?? head.size),
    'Content-Disposition': attachment.kind === 'file' ? `attachment; filename="download.${attachment.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/'/g, '%27')}` : 'inline',
    ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}` } : {}),
  } });
});
export { chatAttachments };
