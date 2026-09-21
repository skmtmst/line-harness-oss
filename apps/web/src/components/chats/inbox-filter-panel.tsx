'use client'

import type { ChatStatus } from './inbox-dropdown'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { Filter, X } from 'lucide-react'

/**
 * 受信箱の絞り込みパネル（設計 Pencil `bXyEA` 受信箱 絞り込みパネル）。
 *
 * 以前は担当者・種別・並び順が一覧の上に並んだままで、**「絞り込みを開く」
 * という操作そのものがありませんでした。** 条件が増えるほど一覧の上が
 * 埋まり、会話が見える面積が減ります。設計は右から出るパネルにまとめます。
 *
 * **繋がっていない条件は、押せない形で出します。**
 * 「期限」と「表示するメッセージ種別」は、いま絞り込める口がありません。
 * 押せるのに何も起きない操作は、無いより悪い（効いたつもりで読み違える）。
 * 出どころができたら `disabled` を外します。
 */

export type InboxFilterValue = {
  status: 'all' | ChatStatus
  assignee: string
  channel: 'all' | 'line' | 'email'
  unreadOnly: boolean
}

const STATUS_OPTIONS: { value: InboxFilterValue['status']; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'unread', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'on_hold', label: '保留' },
  { value: 'resolved', label: '対応済み' },
]

const CHANNEL_OPTIONS: { value: InboxFilterValue['channel']; label: string }[] = [
  { value: 'all', label: 'LINE・MAIL' },
  { value: 'line', label: 'LINE' },
  { value: 'email', label: 'MAIL' },
]

/** 設計の「表示するメッセージ種別」6つ。**まだ絞り込めない。** */
const MESSAGE_KINDS = ['受信', '送信', '自動応答', 'シナリオ・配信', 'フォロー / ブロック', 'システム通知']

const labelClass = 'text-ink-secondary text-xs font-medium'
const fieldClass = 'border-hairline rounded-control bg-canvas text-ink mt-1.5 h-10 w-full border px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50'

export default function InboxFilterPanel({
  open,
  value,
  operators,
  onChange,
  onReset,
  onClose,
}: {
  open: boolean
  value: InboxFilterValue
  operators: { id: string; name: string }[]
  onChange: (next: InboxFilterValue) => void
  onReset: () => void
  onClose: () => void
}) {
  /*
   * INBOX-02: 共通のオーバーレイ約束。開いたらパネル内へフォーカスを移し、
   * Tab が背面へ抜けないように循環させ、背景スクロールを止め、
   * 閉じたあとは「絞り込み」ボタンへフォーカスを戻す。
   */
  const ref = useOverlayFocus(open, onClose)

  if (!open) return null
  const set = (patch: Partial<InboxFilterValue>) => onChange({ ...value, ...patch })

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/*
        INBOX-03: 閉じる操作は背景そのものに繋ぐ。以前は外枠の
        `target === currentTarget` を見ていたが、背景は子要素が全面を覆う
        ためその判定に届かず、灰色部分を押しても閉じなかった。
      */}
      <div className="bg-ink/20 absolute inset-0" aria-hidden="true" onMouseDown={onClose} />
      {/*
        狭い幅では画面の内側16pxいっぱいのシートにする(#982 LAY-04)。
        以前は top/right/width を固定していたため、390pxでは右120pxの
        余白込みで左側が画面外へ消え、下の「この条件で絞り込む」も
        切れていた。
        広い幅では右上寄りのポップオーバーにするが、幅は
        min(420px, 100vw-32px)、高さは 100dvh-80px までに収め、
        ヘッダーとフッターは固定・条件部分だけがスクロールする。
      */}
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="絞り込み"
        className="bg-canvas rounded-panel fixed inset-4 flex w-auto flex-col overflow-hidden shadow-2xl sm:inset-auto sm:top-16 sm:right-6 sm:w-[min(420px,calc(100vw-2rem))] sm:max-h-[calc(100dvh-5rem)] lg:right-10"
      >
        <header className="border-hairline flex h-14 shrink-0 items-center gap-2 border-b px-5">
          <Filter aria-hidden="true" size={18} className="text-ink" />
          <h2 className="text-ink text-base font-bold">絞り込み</h2>
          <button type="button" onClick={onClose} aria-label="絞り込みを閉じる" className="text-ink-faint hover:bg-canvas-sunken ml-auto rounded-control p-1">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <span className={labelClass}>対応状況</span>
            <select
              aria-label="対応状況で絞り込む"
              value={value.status}
              onChange={(event) => set({ status: event.target.value as InboxFilterValue['status'] })}
              className={fieldClass}
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div>
            <span className={labelClass}>担当者</span>
            <select
              aria-label="担当者で絞り込む（パネル）"
              value={value.assignee}
              onChange={(event) => set({ assignee: event.target.value })}
              className={fieldClass}
            >
              <option value="all">すべて</option>
              <option value="unassigned">未割り当て</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </div>

          <div>
            <span className={labelClass}>受信経路</span>
            <select
              aria-label="受信経路で絞り込む"
              value={value.channel}
              onChange={(event) => set({ channel: event.target.value as InboxFilterValue['channel'] })}
              className={fieldClass}
            >
              {CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          {/*
            INBOX-16: まだ絞り込めない条件は、使える条件の下へ畳む。
            無効なまま並べると、使える条件と同じ重さで占有し、
            狭い画面では閉じる操作まで画面外へ追いやられる。
            仕組みができたら畳みを外して有効化する。
          */}
          <details className="border-hairline rounded-control border px-3 py-2.5">
            <summary className="text-ink-faint cursor-pointer text-xs font-medium">
              まだ使えない条件（期限・メッセージ種別）
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <span className={labelClass}>期限</span>
                <select aria-label="期限で絞り込む" className={fieldClass} disabled defaultValue="all">
                  <option value="all">すべて</option>
                </select>
                <p className="text-ink-faint mt-1 text-micro">対応期限はまだ記録していないため、この条件では絞り込めません</p>
              </div>

              <div>
                <span className={labelClass}>表示するメッセージ種別</span>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2">
                  {MESSAGE_KINDS.map((kind) => (
                    <label key={kind} className="text-ink-faint flex items-center gap-2 text-xs">
                      <input type="checkbox" checked readOnly disabled className="accent-accent" />
                      {kind}
                    </label>
                  ))}
                </div>
                <p className="text-ink-faint mt-1 text-micro">メッセージ種別での絞り込みには対応していません</p>
              </div>
            </div>
          </details>

          <label className="border-hairline flex h-10 items-center justify-between border-t pt-3 text-sm">
            <span className="text-ink">未読だけ表示</span>
            <input
              type="checkbox"
              checked={value.unreadOnly}
              onChange={(event) => set({ unreadOnly: event.target.checked })}
              aria-label="未読だけ表示"
              className="accent-accent h-4 w-4"
            />
          </label>
        </div>

        {/*
          INBOX-01: 条件は選んだ時点ですぐ一覧へ反映される（即時適用）。
          「この条件で絞り込む」と書くと、押すまで反映されない・閉じると
          捨てられると読めるため、閉じる操作と実態を一致させる。
          リセットも同じく即時に反映される。
        */}
        <footer className="border-hairline shrink-0 border-t px-5 py-3">
          <p className="text-ink-faint mb-2 text-micro">条件は選ぶとすぐ一覧に反映されます</p>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onReset}
              className="border-hairline rounded-control text-ink-secondary hover:bg-canvas-sunken border px-4 py-2 text-sm"
            >
              リセット
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-control bg-accent-deep text-on-accent hover:brightness-92 px-5 py-2 text-sm font-bold"
            >
              閉じる
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
