import type { CSSProperties } from 'react';

/**
 * 回答フォームの見た目の型の受け口（M5 の下ごしらえ）。
 *
 * 大学生向けの言い換え: あとから来る5つの型（ナチュラル・モダン・やさしい・
 * 夜・LINE らしい）が色を流し込むための「入れ物」。入れ物だけ先に作り、
 * 中身はいまの見た目（⑤ LINE らしい）と同じ値を入れておくので、
 * 画面の見た目は1ピクセルも変わらない。
 *
 * M2 の5型が来たら、このファイルの値を選ぶ分岐を足すだけで
 * 回答フォーム全体に型が当たる。触るのはこのファイルだけ。
 *
 * 受け口と次に埋める係の対応表:
 * - main: 進み具合の棒・選んだ選択肢の枠・ボタン型のブロック・添付のボタン
 *   （送信ボタンは theme.main で済み。店の主の色を入れるのは M2）
 * - soft: 選んだ選択肢の地の色（型の淡い色を入れるのは M2）
 * - line / lineStrong / idle: 枠・選んでいない棒・薄い文字（型ごとに M2）
 * - ink / sub: 見出し・説明（店の見出しの書体・地の色と一緒に M2）
 * - 必須の赤い札・入力の失敗の赤は型の対象外（今のまま固定）
 */
export const FORM_LOOK_DEFAULT = {
  main: '#03873a',
  soft: '#f0fbf4',
  line: '#e6e9ed',
  lineStrong: '#dfe3e8',
  idle: '#b8bec6',
  ink: '#1d1d1f',
  sub: '#5f6670',
} as const;

/** 受け口の変数名。回答フォームの入れ子全体に効く。 */
export type FormLookVarName =
  | '--form-look-main'
  | '--form-look-soft'
  | '--form-look-line'
  | '--form-look-line-strong'
  | '--form-look-idle'
  | '--form-look-ink'
  | '--form-look-sub';

/**
 * 入れ物の中身。いまは既定値（⑤ LINE らしい）だけを返す。
 * 引数を取らないのは、値を選び分ける型・店の色の読み方が M3 の API 待ちのため。
 * M2 が5型を足すときは引数と分岐をここに足す。
 */
export function formLookVars(): CSSProperties {
  return {
    '--form-look-main': FORM_LOOK_DEFAULT.main,
    '--form-look-soft': FORM_LOOK_DEFAULT.soft,
    '--form-look-line': FORM_LOOK_DEFAULT.line,
    '--form-look-line-strong': FORM_LOOK_DEFAULT.lineStrong,
    '--form-look-idle': FORM_LOOK_DEFAULT.idle,
    '--form-look-ink': FORM_LOOK_DEFAULT.ink,
    '--form-look-sub': FORM_LOOK_DEFAULT.sub,
  } as CSSProperties;
}
