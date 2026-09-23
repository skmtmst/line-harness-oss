'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 省略表示される識別子（差し込みキー・フォーム名など）を1操作で全文
 * コピーする小さなボタン（監査6 #665）。
 *
 * `title` 属性は「見える」だけで「取れない」。一覧で `…` に切れた値を
 * 配信文面などへ貼るには、コピーの口を列へ添える必要がある。
 * 成功すると「コピー済み」へ一時的に変わって結果が画面上で分かる。
 *
 * `navigator.clipboard` が使えない環境（非HTTPS・権限拒否）では、省略
 * 表示のままでは全文を取り出せないので、読み取り専用の欄へ切り替えて
 * 選んでコピーできるようにする（ブラウザの入力窓は使わない）。
 */
export default function CopyTextButton({
  value,
  'aria-label': ariaLabel,
}: {
  /** クリップボードへ書き込む全文。表示用文字列ではなく取り出したい値。 */
  value: string
  /** 何をコピーするボタンか。一覧では行の名前を含めて特定できるようにする。 */
  'aria-label': string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setState('idle'), 1500)
    } catch {
      setState('failed')
    }
  }

  if (state === 'failed') {
    /*
     * 隣の表示は `truncate` で切れているため、そのままでは全文を選べない。
     * 失敗したときだけ全文入りの読み取り専用欄を出し、手動で選べるようにする。
     */
    return (
      <span className="block min-w-0">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={ariaLabel}
          className="border-hairline bg-canvas-sunken text-ink w-full rounded border px-2 py-1 text-xs"
        />
        <span role="alert" className="text-danger mt-1 block text-xs">
          コピーできませんでした。上の欄の文字を選択してコピーしてください。
        </span>
      </span>
    )
  }

  /*
   * 表の中の「編集」「削除」と同じく枠なしの文字操作にそろえる。
   * 「コピー」と「コピー済み」で幅が変わると列が揺れるので、
   * 長いほうに合わせて固定幅（w-16）にする。
   */
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={ariaLabel}
      title={state === 'copied' ? 'コピーしました' : 'コピー'}
      className={`w-16 shrink-0 cursor-pointer px-1 py-0.5 text-center text-xs ${
        state === 'copied'
          ? 'text-success font-semibold'
          : 'text-action hover:underline'
      }`}
    >
      {state === 'copied' ? 'コピー済み' : 'コピー'}
    </button>
  )
}
