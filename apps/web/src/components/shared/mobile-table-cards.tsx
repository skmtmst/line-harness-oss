'use client'

import type { KeyboardEvent, ReactNode } from 'react'

/**
 * 1件ぶんのカードの中身。表の列から写すだけにする。
 *
 * - name: 行の名前。2行まで折り返す（消さない・1文字ずつ縦に積まない）。
 *   全文は `nameTitle`（無ければ文字列の名前）で読める。
 * - status: 状態の札（種別・稼働状態など）。無い行は出さない。
 * - summary: 種類・要点などの2行目。
 * - metric: 主な数字（期間つき）の3行目左側。
 * - primaryAction: 主な操作1つ。moreAction: 「…」の残り。
 */
export type MobileTableCard = {
  id: string
  name: ReactNode
  /** 名前の全文。省略時は文字列の名前だけを使う。 */
  nameTitle?: string
  status?: ReactNode
  summary?: ReactNode
  metric?: ReactNode
  primaryAction?: ReactNode
  moreAction?: ReactNode
  /** 行を選ぶと開く場所があるときだけ渡す（テンプレート詳細など）。 */
  onSelect?: () => void
  onSelectLabel?: string
}

function nameText(name: ReactNode): string | undefined {
  return typeof name === 'string' ? name : undefined
}

/**
 * ★V7 監査の直し A（`LD96g`）：スマホ（〜767px）の一覧カード。
 *
 * 共通の表に「スマホではカード」の形を持たせたもの。各画面は表の列から
 * 名前・状態・要点・主な数字を写すだけで、見た目の決まりはここが持つ。
 * 768px 以上では何も描かない（表の側を `hidden md:block` にする）。
 *
 * - 1行目：名前（2行まで・`truncate` で1行に刈らない）＋状態の札
 * - 2行目：要点
 * - 3行目：主な数字＋主な操作1つ＋「…」
 * - 短い文字列を途中で折らない：`break-all` は使わない（縦に1文字ずつ
 *   積まれる原因）。長い名前は2行までに留め、全文は `title` で読める。
 * - 行全体が開く場所のときは表の行と同じ `role="link"` にし、内側の操作は
 *   行へ伝えない（`stopPropagation`）。
 * - 寸法（15px・21px・14px）は設計 `LD96g` のまま。Tailwind の任意値記法
 *   を避けるため `style` で持つ（借金計数の対象にしない）。
 */
export default function MobileTableCards({ items }: { items: MobileTableCard[] }) {
  return (
    <ul className="flex min-w-0 flex-col gap-2 md:hidden" data-design="MobileCards">
      {items.map((item) => {
        const title = item.nameTitle ?? nameText(item.name)
        const openOnKey = (event: KeyboardEvent<HTMLLIElement>) => {
          if (!item.onSelect || event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            item.onSelect()
          }
        }
        return (
          <li
            key={item.id}
            role={item.onSelect ? 'link' : undefined}
            tabIndex={item.onSelect ? 0 : undefined}
            aria-label={item.onSelect ? (title ? `${title}の詳細を開く` : item.onSelectLabel ?? '詳細を開く') : undefined}
            onClick={item.onSelect}
            onKeyDown={item.onSelect ? openOnKey : undefined}
            className="flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-canvas p-3.5"
            style={item.onSelect ? { cursor: 'pointer' } : undefined}
          >
            <div className="flex min-w-0 items-start gap-2">
              <p className="line-clamp-2 min-w-0 flex-1 font-bold text-ink" style={{ fontSize: 15, lineHeight: '21px' }} title={title}>
                {item.name}
              </p>
              {item.status ? <div className="shrink-0">{item.status}</div> : null}
            </div>
            {item.summary ? (
              <p className="min-w-0 text-caption leading-normal text-ink-secondary">{item.summary}</p>
            ) : null}
            {item.metric || item.primaryAction || item.moreAction ? (
              <div className="flex min-w-0 items-center gap-2">
                {item.metric ? (
                  <p className="min-w-0 flex-1 text-label font-semibold leading-snug text-ink">{item.metric}</p>
                ) : null}
                {item.primaryAction ? (
                  <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
                    {item.primaryAction}
                  </span>
                ) : null}
                {item.moreAction ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center" onClick={(event) => event.stopPropagation()}>
                    {item.moreAction}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
