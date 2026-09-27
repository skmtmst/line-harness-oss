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
}

export interface ConvertedAssetMessage {
  messageType: 'carousel' | 'flex' | 'text';
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

function convertRichMessage(name: string, payload: AssetPayloadInput): AssetConversion {
  const imageUrl = text(payload.imageUrl);
  if (!imageUrl) return { ok: false, error: '画像を設定してください' };
  if (!httpsUrl(imageUrl)) return { ok: false, error: '画像は https:// から始まるURLにしてください' };
  const description = text(payload.description);
  const actionUrl = text(payload.actionUrl);
  if (actionUrl && !httpsUrl(actionUrl)) {
    return { ok: false, error: 'タップ時に開くURLは https:// から始まるURLにしてください' };
  }
  // 画像＋説明＋タップ時のリンクを1つの Flex バブルに直す。画像だけの
  // メッセージに落とすと、説明とリンクが消えてしまう。
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    hero: {
      type: 'image',
      url: imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
      ...(actionUrl ? { action: { type: 'uri', uri: actionUrl } } : {}),
    },
  };
  if (description) {
    bubble.body = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: description, wrap: true }],
    };
  }
  const altText = (description || name || 'リッチメッセージ').slice(0, 400);
  return { ok: true, message: { messageType: 'flex', messageContent: JSON.stringify(bubble), altText } };
}

function convertNotice(kind: 'coupon' | 'research', payload: AssetPayloadInput): AssetConversion {
  // クーポン・リサーチに LINE の専用種別は無い。内容とリンク先をそのまま
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
  return convertNotice(kind, payload);
}

/** 素材の種類か（送信用の種別への変換が要るもの）。 */
export function isBroadcastAssetKind(value: unknown): value is BroadcastAssetKind {
  return value === 'rich_message' || value === 'card_message' || value === 'coupon' || value === 'research';
}
