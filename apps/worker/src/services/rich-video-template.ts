import { validateImagemapMessage, validRichVideoUrl } from '@line-crm/shared';
import type { Env } from '../index.js';
import { prepareImagemapImages } from './imagemap-images.js';
import { checkKeyGate, checkMediaGate } from './file-scan.js';

/** 既存のimagemap型で保存する。表・列・migrationは追加しない。 */
export async function prepareRichVideoTemplate(env: Env['Bindings'], type: string, content: string, accountId: string | null, origin: string): Promise<string> {
  if (type !== 'imagemap') return content;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(content); } catch { return content; }
  if (!payload?.video) return content;
  const video = payload.video as Record<string, unknown>;
  // 変換前にも形を検査する。画像準備待ちのbaseUrlだけ仮の値を使う。
  const error = validateImagemapMessage({ ...payload, baseUrl: payload.baseUrl || `${origin}/images/pending` });
  if (error) throw new Error(error);
  for (const [field, mimeTypes, max] of [
    ['originalContentUrl', ['video/mp4'], 200 * 1024 * 1024],
    ['previewImageUrl', ['image/png', 'image/jpeg'], 1024 * 1024],
  ] as const) {
    const raw = video[field];
    if (!validRichVideoUrl(raw)) throw new Error('動画とプレビュー画像のURLを確認してください');
    const url = new URL(raw);
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/images/')) throw new Error('動画とプレビュー画像はファイルをアップロードして選んでください');
    const key = decodeURIComponent(url.pathname.slice('/images/'.length));
    if (key.includes('..')) throw new Error('ファイルの場所を確認してください');
    const media = await env.DB.prepare('SELECT id,line_account_id,filename,mime_type,size_bytes FROM media WHERE r2_key = ? AND archived_at IS NULL').bind(key).first<{id:string;line_account_id:string|null;filename:string;mime_type:string;size_bytes:number}>();
    const session = media ? null : await env.DB.prepare('SELECT line_account_id FROM broadcast_media_upload_sessions WHERE public_key = ? AND completed_at IS NOT NULL').bind(key).first<{line_account_id:string|null}>();
    if (media ? media.line_account_id !== accountId : session ? session.line_account_id !== accountId : !/^broadcast-media\/[\da-f-]{36}\.(png|jpg)$/i.test(key)) throw new Error('このファイルを使用する権限がありません');
    const object = await env.IMAGES.head(key);
    if (!object || object.size < 1 || object.size > max || !(mimeTypes as readonly string[]).includes(object.httpMetadata?.contentType ?? '')) throw new Error(field === 'originalContentUrl' ? '動画はMP4・200MBまでです' : 'プレビュー画像はJPEG・PNG、1MBまでです');
    const gate = media
      ? await checkMediaGate(env.DB, env.IMAGES, {id:media.id,lineAccountId:media.line_account_id,r2Key:key,filename:media.filename,mimeType:media.mime_type,sizeBytes:media.size_bytes})
      : await checkKeyGate(env.DB, env.IMAGES, 'broadcast_asset', key);
    if (!gate.allowed) throw new Error('ファイルの安全性の確認が終わっていません。少し待って保存し直してください');
  }
  // URLをクライアントから信用せず、毎回既存の5サイズ画像の仕組みで作る。
  const prepared = await prepareImagemapImages(env, { imageUrl: video.previewImageUrl, tapAreas: [] }, accountId, origin);
  const baseSize = prepared.baseSize as {width:number;height:number};
  const next = { ...payload, baseUrl: prepared.baseUrl, baseSize, actions: [], video: { ...video, area: {x:0,y:0,width:1040,height:baseSize.height} } };
  const preparedError = validateImagemapMessage(next);
  if (preparedError) throw new Error(preparedError);
  return JSON.stringify(next);
}
