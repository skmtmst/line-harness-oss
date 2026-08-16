/**
 * カルーセルの検証。
 *
 * LINE の決まりに合わないものは送る前に弾く。送ってから
 * 「400 が返りました」では、どのパネルが悪いのか分からない。
 *
 * 数字はすべて LINE Messaging API の公開ドキュメントに書かれているもの。
 * こちらの都合で決めた値は1つも無い。
 */

/** カラム（パネル）の最大枚数 */
export const CAROUSEL_MAX_COLUMNS = 10;
/** 本文の最大文字数。画像を付けると 60、付けないと 120 */
export const CAROUSEL_TEXT_MAX_WITH_IMAGE = 60;
export const CAROUSEL_TEXT_MAX_WITHOUT_IMAGE = 120;
/** タイトルの最大文字数 */
export const CAROUSEL_TITLE_MAX = 40;
/** 1枚あたりのボタン数 */
export const CAROUSEL_ACTIONS_MAX = 3;

export interface CarouselColumn {
  thumbnailImageUrl?: string;
  title?: string;
  text?: string;
  actions?: Array<{ type?: string; label?: string }>;
}

export interface CarouselError {
  /** 何枚目か。1始まり。全体の問題なら null */
  column: number | null;
  message: string;
}

/**
 * 検証する。
 *
 * すべての問題を返す。1つ見つけて止めると、直して保存するたびに
 * 次の問題が出てきて、何度も往復することになる。
 */
export function validateCarousel(raw: unknown): CarouselError[] {
  const errors: CarouselError[] = [];

  if (!Array.isArray(raw)) {
    return [{ column: null, message: 'カルーセルはパネルの配列で指定してください' }];
  }
  if (raw.length === 0) {
    return [{ column: null, message: 'パネルを1枚以上入れてください' }];
  }
  if (raw.length > CAROUSEL_MAX_COLUMNS) {
    errors.push({
      column: null,
      message: `パネルは${CAROUSEL_MAX_COLUMNS}枚までです（いまは${raw.length}枚）`,
    });
  }

  raw.forEach((item, index) => {
    const column = index + 1;
    if (typeof item !== 'object' || item === null) {
      errors.push({ column, message: `${column}枚目の形が正しくありません` });
      return;
    }
    const col = item as CarouselColumn;

    const hasImage = Boolean(col.thumbnailImageUrl);
    // 画像があると本文に使える文字数が半分になる。ここを取り違えると、
    // 画面では収まって見えるのに送信時に弾かれる。
    const textMax = hasImage ? CAROUSEL_TEXT_MAX_WITH_IMAGE : CAROUSEL_TEXT_MAX_WITHOUT_IMAGE;

    const text = col.text ?? '';
    if (!text.trim()) {
      errors.push({ column, message: `${column}枚目の本文を入力してください` });
    } else if ([...text].length > textMax) {
      errors.push({
        column,
        message: hasImage
          ? `${column}枚目の本文は${textMax}文字までです（画像があるため。いまは${[...text].length}文字）`
          : `${column}枚目の本文は${textMax}文字までです（いまは${[...text].length}文字）`,
      });
    }

    if (col.title && [...col.title].length > CAROUSEL_TITLE_MAX) {
      errors.push({
        column,
        message: `${column}枚目のタイトルは${CAROUSEL_TITLE_MAX}文字までです`,
      });
    }

    const actions = col.actions ?? [];
    if (actions.length === 0) {
      // ボタンが1つも無いパネルは送れない。
      errors.push({ column, message: `${column}枚目のボタンを1つ以上入れてください` });
    } else if (actions.length > CAROUSEL_ACTIONS_MAX) {
      errors.push({
        column,
        message: `${column}枚目のボタンは${CAROUSEL_ACTIONS_MAX}個までです（いまは${actions.length}個）`,
      });
    }
    actions.forEach((action, actionIndex) => {
      if (!action?.label?.trim()) {
        errors.push({
          column,
          message: `${column}枚目の${actionIndex + 1}番目のボタンに文字を入れてください`,
        });
      }
    });
  });

  // 画像の有無は全部そろえる決まり。1枚だけ画像が無いと、
  // その枚だけ高さが違って崩れる。
  const withImage = raw.filter(
    (item) => typeof item === 'object' && item !== null && (item as CarouselColumn).thumbnailImageUrl,
  ).length;
  if (withImage > 0 && withImage < raw.length) {
    errors.push({
      column: null,
      message: '画像は全部のパネルに入れるか、全部に入れないかのどちらかにしてください',
    });
  }

  return errors;
}
