import { richMessageActions, type AssetPayloadInput } from '@line-crm/shared';
import type { Env } from '../index.js';
import { imageDimensions } from './media-metadata.js';
import { checkKeyGate, checkMediaGate } from './file-scan.js';

export const IMAGEMAP_WIDTHS = [240,300,460,700,1040] as const;

/** 元画像は所属・検査済みのR2だけから読む。失敗時に元画像で代用しない。 */
export async function prepareImagemapImages(env: Env['Bindings'], payload: Record<string, unknown>, accountId: string | null, origin: string): Promise<Record<string, unknown>> {
  if (!env.CF_IMAGES) throw new Error('リッチメッセージの画像変換が未設定です。管理者に確認してください');
  const url = new URL(String(payload.imageUrl));
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/images/')) throw new Error('リッチメッセージの画像は登録メディアから選んでください');
  const key = decodeURIComponent(url.pathname.slice('/images/'.length));
  if (key.includes('..')) throw new Error('画像の場所を確認してください');
  const media = await env.DB.prepare('SELECT id,line_account_id,filename,mime_type,size_bytes FROM media WHERE r2_key = ? AND archived_at IS NULL').bind(key).first<{id:string;line_account_id:string|null;filename:string;mime_type:string;size_bytes:number}>();
  if (media && media.line_account_id !== accountId) throw new Error('この画像を使用する権限がありません');
  if (!media && !/^broadcast-media\/[\da-f-]{36}\.(jpg|png)$/i.test(key)) throw new Error('画像を登録メディアから選び直してください');
  const gate = media ? await checkMediaGate(env.DB,env.IMAGES,{id:media.id,lineAccountId:media.line_account_id,r2Key:key,filename:media.filename,mimeType:media.mime_type,sizeBytes:media.size_bytes}) : await checkKeyGate(env.DB,env.IMAGES,'broadcast_asset',key);
  if (!gate.allowed) throw new Error('画像の安全性の確認が終わっていません');
  const object = await env.IMAGES.get(key);
  if (!object || object.size > 10 * 1024 * 1024) throw new Error('画像は10MBまでです');
  const bytes = new Uint8Array(await object.arrayBuffer());
  const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const dimensions = imageDimensions(bytes,type);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('画像の大きさを読み取れませんでした');
  const height = Math.round(dimensions.height / dimensions.width * 1040);
  const error = richMessageActions(payload as AssetPayloadInput,height).error;
  if (error) throw new Error(error);
  const id = crypto.randomUUID();
  for (const width of IMAGEMAP_WIDTHS) {
    const output = await env.CF_IMAGES.input(new Blob([bytes]).stream()).transform({width,height: Math.max(1,Math.round(height * width / 1040)),fit:'squeeze'}).output({format:'image/png'});
    const resized = await new Response(output.image()).arrayBuffer();
    if (!resized.byteLength || resized.byteLength > 10 * 1024 * 1024) throw new Error('画像の変換に失敗しました。画像を選び直してください');
    const r2Key = `imagemaps/${id}/${width}`;
    await env.IMAGES.put(r2Key,resized,{httpMetadata:{contentType:'image/png'}});
    await env.DB.prepare('INSERT INTO imagemap_images (id,line_account_id,r2_key,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),accountId,r2Key,new Date().toISOString()).run();
  }
  return {...payload, baseUrl:`${origin}/images/imagemaps/${id}`,baseSize:{width:1040,height},imagemapKey:`imagemaps/${id}`};
}
