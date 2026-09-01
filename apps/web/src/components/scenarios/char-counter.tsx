/*
 * 本文の文字数（設計 `V6 5 kk8dz 1通目設定` の「52 / 5,000」）。
 *
 * 上限を出すのは見た目のためではない。LINEのテキストメッセージは5,000字までで、
 * 超えたぶんは送信そのものが弾かれる。書いている途中に残りが見えないと、
 * 保存を押してから初めて気づくことになる。
 *
 * 上限を超えても入力そのものは止めない。`maxLength` で切ると、貼り付けた
 * 文章が黙って途中で消える。数を赤くして、送る操作の側を押せなくする。
 */

/** LINEのテキストメッセージの上限。 */
export const LINE_TEXT_LIMIT = 5000

/**
 * 「52 / 5,000」の形にする。
 *
 * 桁区切りは `en-US` で固定する。実行環境の既定ロケールに任せると、
 * 端末によって区切りが変わり、設計と突き合わせられない。
 */
export function formatCharCount(length: number, limit: number = LINE_TEXT_LIMIT): string {
  return `${length.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`
}

export function isOverCharLimit(length: number, limit: number = LINE_TEXT_LIMIT): boolean {
  return length > limit
}

export default function CharCounter({
  length,
  limit = LINE_TEXT_LIMIT,
}: {
  length: number
  limit?: number
}) {
  const over = isOverCharLimit(length, limit)
  return (
    <p
      className={`mt-1 text-right text-micro font-medium ${over ? 'text-danger' : 'text-ink-faint'}`}
    >
      {formatCharCount(length, limit)}
      {over && <span className="ml-2">上限を超えています。LINEが送信を受け付けません。</span>}
    </p>
  )
}
