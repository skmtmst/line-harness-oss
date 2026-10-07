import {
  CHAT_FILE_MAX_BYTES, CHAT_FILE_TYPES, CHAT_IMAGE_MAX_BYTES, CHAT_PREVIEW_MAX_BYTES,
  CHAT_VIDEO_MAX_BYTES, type ChatAttachment,
} from '@line-crm/shared';
import type { Message, FlexContainer } from '@line-crm/line-sdk';
import { builtinFileScan } from './file-scan.js';
import { imageDimensions } from './media-metadata.js';
import { extractFlexAltText } from '../utils/flex-alt-text.js';

export const CHAT_ATTACHMENT_PREFIX = 'private/chat-attachments/';
export const CHAT_UPLOAD_PREFIX = 'private/chat-uploads/';
export const CHAT_ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface AttachmentOwner { friendId: string; lineAccountId: string | null }
export class ChatAttachmentError extends Error {
  constructor(message: string, readonly code = 'INVALID_CHAT_ATTACHMENT') { super(message); }
}
export function attachmentUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, '')}/images/chat-attachments/${id}`;
}
export function videoPreviewUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/images/chat-attachments/video-preview.png`;
}

export function uploadKind(mimeType: string, filename: string, size: number): ChatAttachment['kind'] {
  const ext = filename.split('.').pop()?.toLowerCase();
  const kind = mimeType === 'video/mp4' ? 'video'
    : ['image/png', 'image/jpeg'].includes(mimeType) ? 'image' : 'file';
  const extensions = mimeType === 'video/mp4' ? ['mp4'] : mimeType === 'image/jpeg' ? ['jpg', 'jpeg']
    : mimeType === 'image/png' ? ['png'] : [CHAT_FILE_TYPES[mimeType as keyof typeof CHAT_FILE_TYPES]];
  const max = kind === 'video' ? CHAT_VIDEO_MAX_BYTES : kind === 'image' ? CHAT_IMAGE_MAX_BYTES : CHAT_FILE_MAX_BYTES;
  if (!filename || filename.length > 200 || /[\x00-\x1f\x7f/\\]/.test(filename)
    || !ext || !extensions.includes(ext as never) || !Number.isSafeInteger(size) || size < 1 || size > max) {
    throw new ChatAttachmentError('画像はJPEG/PNG・10MB、動画はMP4・200MB、ファイルはPDF・DOCX・XLSX・PPTX・ZIP・10MBまでです');
  }
  return kind;
}

/** ZIPは展開しない。中央ディレクトリとOffice固有の中身の名前を検証する。 */
function validateArchive(bytes: Uint8Array, extension: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50) break;
  }
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50
    || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw new Error('archive');
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (!count || count > 1000 || start + view.getUint32(end + 12, true) !== end) throw new Error('archive');
  let cursor = start;
  const names: string[] = [];
  let unpacked = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('archive');
    const flags = view.getUint16(cursor + 8, true);
    const length = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    if (next > end || offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50 || (flags & 1)) throw new Error('archive');
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + length));
    if (/vbaProject\.bin|\.(exe|dll|com|bat|cmd|scr|js|vbs|ps1|docm|xlsm|pptm)$/i.test(name)
      || name.split(/[/\\]/).includes('..') || /^[/\\]/.test(name)) throw new Error('archive');
    unpacked += view.getUint32(cursor + 24, true);
    if (unpacked > 100 * 1024 * 1024) throw new Error('archive');
    names.push(name);
    cursor = next;
  }
  if (cursor !== end) throw new Error('archive');
  const officeEntries: Record<string, string> = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' };
  const required = officeEntries[extension];
  if (required && (!names.includes('[Content_Types].xml') || !names.includes(required))) throw new Error('archive');
}

export function validateChatUpload(bytes: Uint8Array, mimeType: string, filename: string, size = bytes.length): void {
  const kind = uploadKind(mimeType, filename, size);
  if (kind === 'file' && mimeType !== 'application/pdf') {
    try { validateArchive(bytes, filename.split('.').pop()!.toLowerCase()); }
    catch { throw new ChatAttachmentError('ファイルの形式が正しくないか、暗号化・マクロ・実行ファイルが含まれています'); }
    return;
  }
  const dims = imageDimensions(bytes, mimeType);
  const checked = builtinFileScan(bytes, { filename, mimeType, sizeBytes: size, width: dims?.width, height: dims?.height });
  if (checked.verdict !== 'clean') throw new ChatAttachmentError('ファイルの内容と形式が一致しないか、安全に扱えない内容です');
}

export function metadataFor(attachment: ChatAttachment, owner: AttachmentOwner): Record<string, string> {
  return {
    friendId: owner.friendId, lineAccountId: owner.lineAccountId ?? '',
    filename: attachment.filename, kind: attachment.kind, mimeType: attachment.mimeType,
    expiresAt: attachment.expiresAt ?? '', publicOrigin: new URL(attachment.url).origin,
  };
}
export function attachmentFromObject(id: string, object: R2Object, origin: string): ChatAttachment {
  const meta = object.customMetadata ?? {};
  return {
    id, key: `${CHAT_ATTACHMENT_PREFIX}${id}`, url: attachmentUrl(origin, id),
    filename: meta.filename, mimeType: meta.mimeType, size: object.size,
    kind: meta.kind as ChatAttachment['kind'], expiresAt: meta.expiresAt || null,
  };
}
export async function ownedAttachment(
  bucket: R2Bucket | undefined, id: unknown, owner: AttachmentOwner, origin: string, neededAt = Date.now(),
): Promise<ChatAttachment> {
  if (typeof id !== 'string' || !CHAT_ATTACHMENT_ID.test(id) || !bucket) throw new ChatAttachmentError('添付を選び直してください');
  const object = await bucket.head(`${CHAT_ATTACHMENT_PREFIX}${id}`);
  if (!object || object.customMetadata?.friendId !== owner.friendId
    || object.customMetadata?.lineAccountId !== (owner.lineAccountId ?? '')) throw new ChatAttachmentError('この会話の添付が見つかりません');
  const publicOrigin = origin || object.customMetadata?.publicOrigin || '';
  if (!httpsUrl(publicOrigin)) throw new ChatAttachmentError('添付の公開URLを確認できません');
  const attachment = attachmentFromObject(id, object, publicOrigin);
  uploadKind(attachment.mimeType, attachment.filename, attachment.size);
  if (attachment.kind === 'file' && (!attachment.expiresAt || !Number.isFinite(Date.parse(attachment.expiresAt))
    || Date.parse(attachment.expiresAt) <= Math.max(neededAt, Date.now()))) {
    throw new ChatAttachmentError('ファイルの期限が送信予定より前です。もう一度アップロードしてください', 'CHAT_ATTACHMENT_EXPIRED');
  }
  return attachment;
}
function parseContent(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ChatAttachmentError('添付メッセージの形式が正しくありません'); }
}
function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
function idFromUrl(value: unknown, origin: string): string {
  if (!httpsUrl(value)) throw new ChatAttachmentError('添付URLはHTTPSで指定してください');
  const url = new URL(value);
  const id = url.pathname.slice('/images/chat-attachments/'.length);
  if ((origin && value !== attachmentUrl(origin, id)) || !url.pathname.startsWith('/images/chat-attachments/') || !CHAT_ATTACHMENT_ID.test(id)) throw new ChatAttachmentError('この受信箱でアップロードした動画・画像を選んでください');
  return id;
}

/** すぐ送る口・予約する口・cronで共通。送信前に保存物の所有と期限も確認。 */
export async function buildChatMessage(input: {
  messageType: string; content: string; owner: AttachmentOwner;
  bucket?: R2Bucket; origin: string; neededAt?: number;
}): Promise<{ message: Message; content: string }> {
  const { messageType, content, owner, bucket, origin, neededAt } = input;
  if (messageType === 'text') {
    if (content.length > 5000) throw new ChatAttachmentError('メッセージは5000文字以内で入力してください', 'content_too_long');
    return { message: { type: 'text', text: content }, content };
  }
  if (messageType === 'flex') {
    let contents: FlexContainer;
    try { contents = JSON.parse(content); } catch { throw new ChatAttachmentError('Flexメッセージの形式が正しくありません'); }
    return { message: { type: 'flex', altText: extractFlexAltText(contents), contents }, content };
  }
  if (messageType === 'image') {
    const parsed = parseContent(content);
    if (!httpsUrl(parsed.originalContentUrl) || !httpsUrl(parsed.previewImageUrl)) throw new ChatAttachmentError('画像URLはHTTPSで指定してください');
    return { message: { type: 'image', originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl }, content };
  }
  if (messageType === 'video') {
    const parsed = parseContent(content);
    const video = await ownedAttachment(bucket, idFromUrl(parsed.originalContentUrl, origin), owner, origin, neededAt);
    if (parsed.originalContentUrl !== video.url) throw new ChatAttachmentError('この受信箱でアップロードした動画を選んでください');
    if (video.kind !== 'video') throw new ChatAttachmentError('MP4動画を選んでください');
    let preview = videoPreviewUrl(new URL(video.url).origin);
    if (parsed.previewImageUrl !== undefined && parsed.previewImageUrl !== preview) {
      const image = await ownedAttachment(bucket, idFromUrl(parsed.previewImageUrl, origin), owner, origin, neededAt);
      if (parsed.previewImageUrl !== image.url || image.kind !== 'image' || image.size > CHAT_PREVIEW_MAX_BYTES) throw new ChatAttachmentError('プレビューはJPEG/PNG・1MBまでです');
      preview = image.url;
    }
    const payload = { originalContentUrl: video.url, previewImageUrl: preview };
    return { message: { type: 'video', ...payload }, content: JSON.stringify(payload) };
  }
  if (messageType === 'file') {
    const parsed = parseContent(content);
    const file = await ownedAttachment(bucket, parsed.attachmentId, owner, origin, neededAt);
    if (file.kind !== 'file') throw new ChatAttachmentError('ファイルを選んでください');
    const expiresLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(file.expiresAt!));
    const text = `${file.filename}\n${Math.max(0.01, file.size / 1024 / 1024).toFixed(2)} MB\n${file.url}\nダウンロード期限: ${expiresLabel}（日本時間）`;
    return { message: { type: 'text', text }, content: JSON.stringify({ attachmentId: file.id, ...file }) };
  }
  throw new ChatAttachmentError('messageType is not supported');
}
