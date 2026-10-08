import { validateFlexMessage } from './line-message-limits.js';
/**
 * 配信用素材 → LINE の正規形。
 *
 * カルーセル・リッチメッセージ・クーポン・リサーチは、画面だけで作った
 * 独自の形で、LINE にそのまま渡せる種別が無い。別々に書いていたときは、
 * 画面では通るのに送信で「未対応」で断られるか、中身の JSON がそのまま
 * 相手のトークに届いていた。
 *
 * **画面の保存（1吹き出し）と Worker の複数吹き出し解析が同じ関数を使う。**
 * 片方だけ直すと必ずまたずれるので、変換と検証はここに1つだけ置く。
 */

export type BroadcastAssetKind = 'rich_message' | 'card_message' | 'coupon' | 'research';

export interface AssetCardInput {
  imageUrl?: unknown;
  title?: unknown;
  description?: unknown;
  actionLabel?: unknown;
  actionUrl?: unknown;
}

export interface AssetPayloadInput {
  cards?: unknown;
  moreCard?: unknown;
  imageUrl?: unknown;
  description?: unknown;
  actionUrl?: unknown;
  baseUrl?: unknown;
  baseSize?: unknown;
  tapAreas?: unknown;
  coordinateUnit?: unknown;
  assetId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  oncePerFriend?: unknown;
  maxUsesPerFriend?: unknown;
  instructions?: unknown;
  title?: unknown;
  lottery?: unknown;
  questions?: unknown;
  imageMediaId?: unknown;
  imageMediaKind?: unknown;
  imagemapImages?: unknown;
  visibility?: unknown;
  lotteryRate?: unknown;
  winnerLimit?: unknown;
  useActions?: unknown;
  targetTagId?: unknown;
  showProgress?: unknown;
  showResult?: unknown;
}

export interface ConvertedAssetMessage {
  messageType: 'carousel' | 'flex' | 'text' | 'imagemap';
  messageContent: string;
  altText: string;
}

export type AssetConversion =
  | { ok: true; message: ConvertedAssetMessage }
  | { ok: false; error: string };

/** カルーセルのパネル上限（LINE の template carousel は10列まで）。 */
export const ASSET_MAX_PANELS = 10;

const KIND_LABEL: Record<BroadcastAssetKind, string> = {
  rich_message: 'リッチメッセージ',
  card_message: 'カルーセル',
  coupon: 'クーポン',
  research: 'リサーチ',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function httpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * 保存時の形の検査。配信できるかではなく、作りかけとして保てるかを見る。
 *
 * 枚数と必須項目だけを見て、リンク先の有無は見ない。リンク先が無くても
 * 保存はできるが、そのままでは配信できないことは変換（convertBroadcastAsset）
 * が保存・送信の直前で具体的に指摘する。
 */
export function validateAssetPayload(kind: BroadcastAssetKind, payload: AssetPayloadInput): string | null {
  if (kind === 'card_message') {
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    if (cards.length < 1 || cards.length > ASSET_MAX_PANELS) {
      return `パネルは1〜${ASSET_MAX_PANELS}枚で設定してください（いまは${cards.length}枚）`;
    }
    if (payload.moreCard === true && cards.length > ASSET_MAX_PANELS - 1) {
      return `「もっと見る」パネルを付けるときは${ASSET_MAX_PANELS - 1}枚までです。パネルを減らすか、「もっと見る」を外してください`;
    }
    for (let index = 0; index < cards.length; index++) {
      const card = (cards[index] ?? {}) as AssetCardInput;
      if (!text(card.title)) return `パネル${index + 1}にタイトルを入力してください`;
    }
    return null;
  }
  if (kind === 'rich_message') {
    if (!text(payload.imageUrl)) return '画像を設定してください';
    if (payload.tapAreas !== undefined) return richMessageActions(payload, Number((payload.baseSize as { height?: number } | undefined)?.height ?? 1040)).error ?? null;
    return null;
  }
  if (kind === 'coupon') return couponPayloadError(payload);
  if (payload.questions !== undefined) {
    if(!Array.isArray(payload.questions) || payload.questions.length<1 || payload.questions.length>10) return '質問は1〜10問で設定してください';
    for(const item of payload.questions) {
      if(!item || typeof item!=='object') return '質問の内容を確認してください';
      const q=item as Record<string,unknown>;
      if(!text(q.text) || !['single','multiple','free'].includes(String(q.format)) || typeof q.required!=='boolean') return '質問文・答え方・必須の指定を確認してください';
      if(q.format!=='free' && (!Array.isArray(q.choices) || q.choices.length<1 || q.choices.length>13 || q.choices.some(choice=>!text(choice)))) return '選択肢は1〜13件で設定してください';
    }
    // 質問のみでも店のリサーチとして保存できる。
    return null;
  }
  if (!text(payload.description) && !text(payload.actionUrl)) {
    return `${KIND_LABEL[kind]}の内容またはリンク先を入力してください`;
  }
  return null;
}

interface CarouselColumn {
  thumbnailImageUrl?: string;
  title?: string;
  text: string;
  actions: Array<{ type: 'uri'; label: string; uri: string }>;
}

function convertCardMessage(name: string, payload: AssetPayloadInput): AssetConversion {
  const shapeError = validateAssetPayload('card_message', payload);
  if (shapeError) return { ok: false, error: shapeError };
  const cards = (payload.cards as AssetCardInput[]).map((card) => ({
    imageUrl: text(card.imageUrl),
    title: text(card.title),
    description: text(card.description),
    actionLabel: text(card.actionLabel),
    actionUrl: text(card.actionUrl),
  }));

  // 画像の有無は全部そろえる決まり。1枚だけ違うと、その枚だけ高さが
  // 違って崩れる（従来型カルーセルの検証と同じ）。
  const withImage = cards.filter((card) => card.imageUrl).length;
  if (withImage > 0 && withImage < cards.length) {
    return { ok: false, error: '画像は全部のパネルに入れるか、全部に入れないかのどちらかにしてください' };
  }

  const columns: CarouselColumn[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    const body = card.description || card.title;
    if (!body) return { ok: false, error: `パネル${index + 1}の説明を入力してください` };
    if (!card.actionUrl) return { ok: false, error: `パネル${index + 1}のリンク先を入力してください（配信で開くページ）` };
    if (!httpsUrl(card.actionUrl)) {
      return { ok: false, error: `パネル${index + 1}のリンク先は https:// から始まるURLにしてください` };
    }
    // タイトルか画像があると本文に使える文字数が半分になる（LINE の決まり）。
    const textMax = card.title || card.imageUrl ? 60 : 120;
    if ([...body].length > textMax) {
      return { ok: false, error: `パネル${index + 1}の説明は${textMax}文字までです（いまは${[...body].length}文字）` };
    }
    columns.push({
      ...(card.imageUrl ? { thumbnailImageUrl: card.imageUrl } : {}),
      ...(card.title ? { title: card.title } : {}),
      text: body,
      actions: [{ type: 'uri', label: card.actionLabel || '詳しく見る', uri: card.actionUrl }],
    });
  }

  if (payload.moreCard === true) {
    // 「もっと見る」に専用のリンク先は持たない。ふつうは全部のパネルが
    // 同じ案内のページを開くので、先頭のリンク先へ寄せる。どこにも
    // リンク先が無ければ、付けたままでは送れないことを伝える。
    const moreUrl = cards.map((card) => card.actionUrl).find((url) => url);
    if (!moreUrl) {
      return { ok: false, error: '「もっと見る」のリンク先にするため、どれかのパネルにリンク先を入力してください' };
    }
    columns.push({
      text: 'もっと見る',
      actions: [{ type: 'uri', label: 'もっと見る', uri: moreUrl }],
    });
  }

  const altText = (columns[0]?.title || columns[0]?.text || name || 'カルーセル').slice(0, 400);
  return { ok: true, message: { messageType: 'carousel', messageContent: JSON.stringify(columns), altText } };
}

export function richMessageActions(payload: AssetPayloadInput, height: number): { actions?: Record<string, unknown>[]; error?: string } {
  const taps = Array.isArray(payload.tapAreas) ? payload.tapAreas : [];
  if (taps.length > 50) return { error: 'タップ範囲は50個までです' };
  const actions: Record<string, unknown>[] = [];
  for (const [index, tap] of taps.entries()) {
    if (!tap || typeof tap !== 'object') return { error: `タップ範囲${index + 1}を確認してください` };
    const area = tap as Record<string, unknown>;
    const raw = [area.x, area.y, area.width, area.height];
    if (raw.some(v => typeof v !== 'number' || !Number.isFinite(v))) return { error: `タップ範囲${index + 1}の座標を数値で入力してください` };
    const [x, y, w, h] = raw as number[];
    const percent = payload.coordinateUnit !== 'px';
    const maxX = percent ? 100 : 1040;
    const maxY = percent ? 100 : height;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > maxX + 0.02 || y + h > maxY + 0.02) return { error: `タップ範囲${index + 1}が画像の外にはみ出しています` };
    if (area.actionType === 'none') continue;
    const left = Math.round(percent ? x * 10.4 : x);
    const top = Math.round(percent ? y * height / 100 : y);
    const right = Math.min(1040, Math.round(percent ? (x + w) * 10.4 : x + w));
    const bottom = Math.min(height, Math.round(percent ? (y + h) * height / 100 : y + h));
    if (right <= left || bottom <= top) return { error: `タップ範囲${index + 1}が小さすぎます` };
    const action = { area: { x: left, y: top, width: right - left, height: bottom - top }, ...(text(area.label) ? { label: text(area.label).slice(0,100) } : {}) };
    if (area.actionType === 'uri') {
      const uri = text(area.uri ?? area.value ?? area.linkUri);
      if (!/^(https?:|line:|tel:)/i.test(uri) || uri.length > 1000) return { error: `タップ範囲${index + 1}のリンク先を確認してください` };
      actions.push({ ...action, type: 'uri', linkUri: uri });
    } else if (area.actionType === 'message') {
      const message = text(area.text ?? area.value);
      if (!message || message.length > 400) return { error: `タップ範囲${index + 1}の送る文章は1〜400文字で入力してください` };
      actions.push({ ...action, type: 'message', text: message });
    } else return { error: `タップ範囲${index + 1}はURLまたはメッセージを選んでください。イメージマップはpostbackに対応していません` };
  }
  return { actions };
}

function convertRichMessage(name: string, payload: AssetPayloadInput): AssetConversion {
  const baseUrl = text(payload.baseUrl);
  const size = payload.baseSize as { width?: unknown; height?: unknown } | undefined;
  if (!httpsUrl(baseUrl) || baseUrl.length > 2000 || !size || size.width !== 1040 || !Number.isInteger(size.height) || Number(size.height) <= 0) {
    return { ok: false, error: 'リッチメッセージの画像サイズを準備してください。素材を保存し直してください' };
  }
  const result = richMessageActions(payload, Number(size.height));
  if (result.error) return { ok: false, error: result.error };
  if (!result.actions?.length) return { ok:false,error:'タップ範囲にURLかメッセージを1つ以上設定してください' };
  const altText = (text(payload.description) || name || 'リッチメッセージ').slice(0,1500);
  return { ok: true, message: { messageType: 'imagemap', altText, messageContent: JSON.stringify({ baseUrl, baseSize: size, actions: result.actions, altText }) } };
}

function convertCoupon(name: string, payload: AssetPayloadInput): AssetConversion {
  const assetId = text(payload.assetId);
  if (!assetId) return { ok: false, error: 'クーポンを素材として保存してから選んでください' };
  const error = couponPayloadError(payload);
  if (error) return { ok: false, error };
  const title = text(payload.title) || name || 'クーポン';
  const body = [
    { type: 'text', text: title, weight: 'bold', wrap: true },
    { type: 'text', text: text(payload.description), wrap: true },
    { type: 'text', text: `有効期間：${text(payload.startsAt)}〜${text(payload.endsAt)}`, wrap: true, size: 'sm' },
    { type: 'text', text: text(payload.instructions) || 'お店で確認してから「使う」を押してください', wrap: true, size: 'sm' },
    { type: 'text', text: payload.oncePerFriend === false && payload.maxUsesPerFriend == null ? '期間中は何回でも使えます' : `1人${Number(payload.maxUsesPerFriend ?? 1)}回まで`, wrap: true, size: 'sm' },
  ];
  const bubble = { type: 'bubble',
    ...(text(payload.imageUrl) ? { hero: { type: 'image', url: text(payload.imageUrl), size: 'full', aspectMode: 'fit' } } : {}),
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', action: { type: 'postback', label: '使う', data: `coupon_use:${assetId}` } }] },
  };
  const sizeError = validateFlexMessage(bubble);
  if (sizeError) return {ok:false,error:sizeError};
  return { ok: true, message: { messageType: 'flex', messageContent: JSON.stringify(bubble), altText: title.slice(0,400) } };
}

/** 日付入力は日本時間。期限・上限を欠いたクーポンを文章に落とさない。 */
export function couponPayloadError(payload: AssetPayloadInput): string | null {
  if (!text(payload.description)) return 'クーポンの内容を入力してください';
  const from = couponDate(text(payload.startsAt));
  const until = couponDate(text(payload.endsAt));
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return 'クーポンの開始と終了を正しい順で入力してください';
  if (payload.maxUsesPerFriend != null && (!Number.isSafeInteger(payload.maxUsesPerFriend) || Number(payload.maxUsesPerFriend) < 1)) return '使える回数は1以上の整数で入力してください';
  if (text(payload.imageUrl) && !httpsUrl(text(payload.imageUrl))) return 'クーポンの画像は https:// から始めてください';
  if (payload.lottery === true) return '抽選クーポンはまだ送れません。抽選を外してください';
  return null;
}
export function couponDate(value: string): number {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}${value.length === 10 ? 'T00:00:00' : ''}+09:00`);
}

function convertNotice(kind: 'research', payload: AssetPayloadInput): AssetConversion {
  // リサーチの内容とリンク先をそのまま
  // 読める文にする。**素材の中身の JSON を本文にしない。**
  const description = text(payload.description);
  const actionUrl = text(payload.actionUrl);
  if (!description && !actionUrl) {
    return { ok: false, error: `${KIND_LABEL[kind]}の内容またはリンク先を入力してください` };
  }
  if (actionUrl && !httpsUrl(actionUrl)) {
    return { ok: false, error: 'リンク先は https:// から始まるURLにしてください' };
  }
  const body = [description, actionUrl].filter(Boolean).join('\n');
  return { ok: true, message: { messageType: 'text', messageContent: body, altText: body.slice(0, 400) } };
}

/**
 * 配信用素材を、LINE へそのまま渡せる種別と中身に直す。
 *
 * 画面の保存（1吹き出しのときの中身）と Worker の複数吹き出し解析が、
 * どちらもこの関数を通る。ここで弾かれた理由は、そのまま利用者への
 * 直し方（どのパネルの何を直すか）になる。
 */
export function convertBroadcastAsset(
  kind: BroadcastAssetKind,
  name: string,
  payload: AssetPayloadInput,
): AssetConversion {
  if (kind === 'card_message') return convertCardMessage(name, payload);
  if (kind === 'rich_message') return convertRichMessage(name, payload);
  if (kind === 'coupon') return convertCoupon(name, payload);
  return convertNotice(kind, payload);
}

/** 素材の種類か（送信用の種別への変換が要るもの）。 */
export function isBroadcastAssetKind(value: unknown): value is BroadcastAssetKind {
  return value === 'rich_message' || value === 'card_message' || value === 'coupon' || value === 'research';
}
