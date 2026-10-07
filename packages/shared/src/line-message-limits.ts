/** LINE公式: https://developers.line.biz/ja/reference/messaging-api/nojs/ */
export function validateFlexMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'カードの中身をJSONで入力してください';
  const node = value as Record<string, unknown>;
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (node.type === 'bubble') return bytes > 30 * 1024 ? 'カード1枚の容量は30KBまでです。文字や部品を減らしてください' : null;
  if (node.type !== 'carousel') return 'Flexはバブルかカルーセルの形にしてください';
  if (!Array.isArray(node.contents) || node.contents.length < 1 || node.contents.length > 12) return 'カードは1〜12枚で設定してください';
  if (bytes > 50 * 1024) return 'カード全体の容量は50KBまでです。文字や部品を減らしてください';
  const sizes = new Set<string>();
  for (const item of node.contents) {
    if (!item || item.type !== 'bubble') return 'カルーセルの中にはカード（bubble）を入れてください';
    const error = validateFlexMessage(item);
    if (error) return error;
    sizes.add(item.size ?? 'mega');
  }
  return sizes.size > 1 ? 'カルーセルのカードの幅をそろえてください' : null;
}

/** 改行・文末を優先。結合すると元の本文に戻り、絵文字も途中で切らない。 */
export function splitBroadcastText(text: string, limit = 4500): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(offset + limit, chars.length);
    if (end < chars.length) {
      for (let i = end - 1; i >= offset + Math.floor(limit / 2); i--) {
        if (/[\n。！？.!?]/u.test(chars[i])) { end = i + 1; break; }
      }
    }
    chunks.push(chars.slice(offset, end).join(''));
    offset = end;
  }
  return chunks.length ? chunks : [''];
}

/** 変換済みのイメージマップも保存時と送信時に検査する。 */
export function validateImagemapMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'リッチメッセージの中身を確認してください';
  const p = value as {baseUrl?:unknown;baseSize?:{width?:number;height?:number};actions?:Array<{type?:string;linkUri?:string;text?:string;area?:{x?:number;y?:number;width?:number;height?:number}}>;altText?:unknown};
  if (typeof p.baseUrl !== 'string' || !/^https:\/\//.test(p.baseUrl) || p.baseUrl.length > 2000) return '画像のURLはHTTPS・2,000文字までです';
  const height = p.baseSize?.height;
  if (p.baseSize?.width !== 1040 || !Number.isSafeInteger(height) || Number(height) < 1) return '画像の基準幅は1040、高さは正の整数にしてください';
  if (p.altText !== undefined && (typeof p.altText !== 'string' || !p.altText.trim() || Array.from(p.altText).length > 1500)) return 'リッチメッセージの通知文は1〜1,500文字にしてください';
  if (!Array.isArray(p.actions) || p.actions.length < 1 || p.actions.length > 50) return 'タップ範囲は1〜50個にしてください';
  for (const action of p.actions) {
    if (!action || !action.area) return 'タップ範囲を設定してください';
    const {x,y,width,height:h}=action.area;
    if (![x,y,width,h].every(Number.isSafeInteger) || Number(x)<0 || Number(y)<0 || Number(width)<1 || Number(h)<1 || Number(x)+Number(width)>1040 || Number(y)+Number(h)>Number(height)) return 'タップ範囲が画像の外に出ています';
    if (action.type === 'uri') {
      if (typeof action.linkUri !== 'string' || !/^(https?:|line:|tel:)/.test(action.linkUri) || action.linkUri.length > 1000) return 'タップ先のURLは1,000文字以内で設定してください';
    } else if (action.type === 'message') {
      if (typeof action.text !== 'string' || !action.text.trim() || Array.from(action.text).length > 400) return 'タップ時のメッセージは1〜400文字にしてください';
    } else return 'タップの動作はURLかメッセージを選んでください';
  }
  return null;
}
