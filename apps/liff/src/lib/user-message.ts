/**
 * お客さん向け画面 (LIFF) の失敗・読み込み中の文言。
 *
 * 決めごと: API の失敗の中身 (`Error: API 500: {...}` や内部の erro 名) を
 * 画面に出さない。画面には日本語の1文だけ出し、くわしい中身は
 * console にだけ残す。試験で文言を固定する (言い換え防止)。
 */

/**
 * 読み込みの失敗を画面に出すときの1文。題の「読み込めませんでした」と
 * 重ねない (★V7)。画面ごとの一言は LoadErrorView の note に足す。
 */
export const LOAD_FAILED_MESSAGE = '電波の良いところで、もう一度お試しください。';

/** 読み直しのボタンの文言。全画面で同じにする。 */
export const RETRY_LABEL = 'もう一度読み込む';

/** 読み込み中の文言。全画面で同じにする。 */
export const LOADING_LABEL = '読み込み中...';

/**
 * 送信の失敗のときの汎用文。入力は消さず、その場で理由を出す。
 * サーバが理由を返さなかった場合の落としどころ。
 */
export const SUBMIT_FAILED_MESSAGE =
  '送信できませんでした。時間をおいて、もう一度お試しください。';

/**
 * 失敗のくわしい中身を console にだけ残す。画面には出さない。
 */
export function logFailure(scope: string, err: unknown): void {
  console.error(`[liff:${scope}]`, err);
}
