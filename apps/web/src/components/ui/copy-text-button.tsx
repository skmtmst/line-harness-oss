'use client'

import { useState } from 'react'

import { Check } from 'lucide-react'

import { CopyAnnounce, useCopy } from '@/lib/copy'

/**
 * 省略表示される識別子（差し込みキー・フォーム名など）を1操作で全文
 * コピーする小さなボタン（監査6 #665）。
 *
 * `title` 属性は「見える」だけで「取れない」。一覧で `…` に切れた値を
 * 配信文面などへ貼るには、コピーの口を列へ添える必要がある。
 * 成功すると印が約1.2秒 ✓ に変わる。知らせ（Toast）は出さず、
 * 読み上げは「コピーしました」（★V7 §11）。
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
  const { copied, copy } = useCopy()
  const [failed, setFailed] = useState(false)

  const onCopy = async () => {
    const ok = await copy(value)
    if (!ok) setFailed(true)
  }

  if (failed) {
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
          className="border-hairline bg-canvas-sunken text-ink w-full rounded-mini border px-2 py-1 text-xs"
        />
        <span role="alert" className="text-danger mt-1 block text-xs">
          コピーできませんでした。上の欄の文字を選択してコピーしてください。
        </span>
      </span>
    )
  }

  /*
   * 表の中の「編集」「削除」と同じく枠なしの文字操作にそろえる。
   * 「コピー」と「コピーしました」で幅が変わると列が揺れるので、
   * 長いほうに合わせて固定幅にする。
   */
  return (
    <>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={ariaLabel}
        title={copied() ? 'コピーしました' : 'コピー'}
        className={`inline-flex w-20 shrink-0 cursor-pointer items-center justify-center gap-1 px-1 py-0.5 text-center text-xs ${
          copied() ? 'text-success font-semibold' : 'text-action hover:underline'
        }`}
      >
        {copied() ? (
          <>
            <Check size={12} aria-hidden="true" />
            コピー済み
          </>
        ) : (
          'コピー'
        )}
      </button>
      <CopyAnnounce show={copied()} />
    </>
  )
}
