import type { CSSProperties } from 'react';

/**
 * LIFF の見た目の型の受け口（M5 の下ごしらえ）。
 *
 * 大学生向けの言い換え: あとから来る5つの型（ナチュラル・モダン・やさしい・
 * 夜・LINE らしい）が色・書体・角丸を流し込むための「入れ物」。入れ物だけ先に
 * 作り、中身はいまの見た目（⑤ LINE らしい）と同じ値を入れておくので、
 * 画面の見た目は1ピクセルも変わらない。
 *
 * 値は `main.tsx` で文書全体に1回だけ置く（`applyLiffLook`）。画面ごとの
 * ばらまきは要らない。M2 の5型が来たら、このファイルの値を選ぶ分岐を足し、
 * 店ごとの上書き（主の色・地の色・見出しの書体）の読み方を M3 の API に
 * 合わせるだけで、全画面に型が当たる。
 *
 * 受け口と次に埋める係の対応表:
 * - main: 進み具合の棒・選んだ枠・ボタン型・添付・CTA・進み具合（店の主の色は M2）
 * - soft / waitBg / waitInk / okBg / okInk: 選んだ地・待ち・確定の札と印（型の淡色は M2）
 * - line / lineStrong / divider: 枠・線・区切り（型ごとに M2）
 * - chip / offBg: 切り替えの地・日付の四角・骨組み（型ごとに M2）
 * - idle / ink / sub: 薄い文字・見出しと本文・説明（見出しの書体と一緒に M2）
 * - deep: マイルの貯まった箱の深い緑（型ごとに M2）
 * - fontBody / fontHeading: 本文・見出しの書体（いまは本文と同じ。やさしい型の丸ゴシック等は M2）
 * - radius: よく押す角丸（10px の所だけ。8px・14px・丸は今のまま。統一は M2）
 *
 * 型の対象外（今のまま固定。変数にしない）:
 * - 必須の赤い札・入力の失敗の赤・危ない操作の赤（意味の色）
 * - 押せない満席の灰色・上限お知らせの info の帯（契約テストが文面で固定）
 * - 送信ボタン（フォームの theme.main で済み）・主ボタンの部品（契約テストが固定）
 * - ウェビナーの暗い地（別画面の決まり）
 */
export const LIFF_LOOK_DEFAULT = {
  main: '#03873a',
  soft: '#f0fbf4',
  line: '#e6e9ed',
  lineStrong: '#dfe3e8',
  idle: '#b8bec6',
  ink: '#1d1d1f',
  sub: '#5f6670',
  chip: '#f1f3f5',
  offBg: '#f7f8f9',
  okBg: '#e8f8ee',
  okInk: '#0a7a3e',
  waitBg: '#fff6e5',
  waitInk: '#b26b00',
  divider: '#eef0f2',
  deep: '#0f3d24',
  fontBody:
    '"Inter", "Noto Sans JP", system-ui, -apple-system, "BlinkMacSystemFont", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif',
  fontHeading:
    '"Inter", "Noto Sans JP", system-ui, -apple-system, "BlinkMacSystemFont", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif',
  radius: '0.625rem',
} as const;

/** 受け口の変数名。文書全体に効く。 */
export type LiffLookVarName =
  | '--liff-look-main'
  | '--liff-look-soft'
  | '--liff-look-line'
  | '--liff-look-line-strong'
  | '--liff-look-idle'
  | '--liff-look-ink'
  | '--liff-look-sub'
  | '--liff-look-chip'
  | '--liff-look-off-bg'
  | '--liff-look-ok-bg'
  | '--liff-look-ok-ink'
  | '--liff-look-wait-bg'
  | '--liff-look-wait-ink'
  | '--liff-look-divider'
  | '--liff-look-deep'
  | '--liff-look-font-body'
  | '--liff-look-font-heading'
  | '--liff-look-radius';

/**
 * 入れ物の中身。いまは既定値（⑤ LINE らしい）だけを返す。
 * 引数を取らないのは、値を選び分ける型・店の色の読み方が M2・M3 待ちのため。
 * 5型を足すときは引数と分岐をここに足す。
 */
export function liffLookVars(): CSSProperties {
  const d = LIFF_LOOK_DEFAULT;
  return {
    '--liff-look-main': d.main,
    '--liff-look-soft': d.soft,
    '--liff-look-line': d.line,
    '--liff-look-line-strong': d.lineStrong,
    '--liff-look-idle': d.idle,
    '--liff-look-ink': d.ink,
    '--liff-look-sub': d.sub,
    '--liff-look-chip': d.chip,
    '--liff-look-off-bg': d.offBg,
    '--liff-look-ok-bg': d.okBg,
    '--liff-look-ok-ink': d.okInk,
    '--liff-look-wait-bg': d.waitBg,
    '--liff-look-wait-ink': d.waitInk,
    '--liff-look-divider': d.divider,
    '--liff-look-deep': d.deep,
    '--liff-look-font-body': d.fontBody,
    '--liff-look-font-heading': d.fontHeading,
    '--liff-look-radius': d.radius,
  } as CSSProperties;
}

/**
 * 文書全体に受け口を置く。`main.tsx` で起動時に1回だけ呼ぶ。
 * 予約・ウェビナーなど M2 作業中の画面も含め、全部の画面に既定値が効く。
 */
export function applyLiffLook(
  target?: { setProperty(name: string, value: string): void },
): void {
  const style =
    target ?? (typeof document !== 'undefined' ? document.documentElement.style : undefined);
  if (!style) return;
  for (const [name, value] of Object.entries(liffLookVars())) {
    style.setProperty(name, value as string);
  }
}
