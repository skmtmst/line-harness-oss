/**
 * カルーセルの選択肢が押されたことを受け取るための約束事。
 *
 * リッチメニュー（rich-menu-tap.ts）と同じ考え方。postback の data に、
 * どのテンプレートのどの選択肢かを入れておき、webhook で剥がして使う。
 *
 * 形:
 *   ctpl=<テンプレートid>&c=<パネル番号>&a=<選択肢番号>
 *
 * 選択肢そのものの JSON には持たせない。columns は LINE へそのまま渡すので、
 * LINE が知らないフィールドを混ぜると弾かれる。
 */

const PREFIX = 'ctpl=';

export type CarouselTapPostback = {
  templateId: string;
  columnIndex: number;
  actionIndex: number;
};

export function buildCarouselPostbackData(
  templateId: string,
  columnIndex: number,
  actionIndex: number,
): string {
  return `${PREFIX}${templateId}&c=${columnIndex}&a=${actionIndex}`;
}

/**
 * postback data がカルーセル由来なら中身を返す。そうでなければ null。
 * null が返った場合、呼び出し側は今までどおりの処理を続ければよい。
 */
export function parseCarouselPostbackData(data: string): CarouselTapPostback | null {
  if (typeof data !== 'string' || !data.startsWith(PREFIX)) return null;
  const matched = /^ctpl=([^&]+)&c=(\d+)&a=(\d+)$/.exec(data);
  if (!matched) return null;
  const templateId = matched[1].trim();
  if (!templateId) return null;
  return {
    templateId,
    columnIndex: Number(matched[2]),
    actionIndex: Number(matched[3]),
  };
}

/**
 * `carousel_actions_json` から、その選択肢のアクションを取り出す。
 *
 * 読めない設定は空として扱う。ここで落とすと、押しても何も起きないうえに
 * webhook が転ぶ。何も起きないだけのほうが害が小さい。
 */
export function pickCarouselActions(
  raw: string | null | undefined,
  columnIndex: number,
  actionIndex: number,
): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown[]>>;
    const column = parsed?.[String(columnIndex)];
    const actions = column?.[String(actionIndex)];
    return Array.isArray(actions) ? actions : [];
  } catch {
    console.error('[carouselTap] unreadable carousel_actions_json — ignored');
    return [];
  }
}
