import Link from 'next/link'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ErrorCountBadge } from './error-count-badge'
import { cancelMeasurement, scheduleMeasurement } from './dom-measurement-batch'
import { observeElementResize } from './element-resize-observer'
import styles from './tabs.module.css'
import { SlidingIndicator } from './sliding-indicator'

export interface TabItem {
  /** 対応するパネルから参照するタブの ID。 */
  id?: string
  /** このタブが開くパネルの ID。 */
  controls?: string
  /** タブの見出し。 */
  label: string
  /** 押したときの行き先。省くとボタンとして描く。 */
  href?: string
  /** 見出しの右に出す数。0 も出す（「0件ある」は情報なので隠さない）。 */
  count?: number
  /** 確認待ちなど、注意して見る件数を丸い札で示す。 */
  countTone?: 'warning'
  /** このタブの中の直す欄の数。1以上で赤い丸を出す。`useFormErrors.countIn` を渡す。 */
  errorCount?: number
  /** いま開いているタブ。 */
  current?: boolean
  disabled?: boolean
  disabledReason?: string
  onClick?: () => void
}

/**
 * ページ内タブ。Pencil V5 の `VPn1F`（選択中）／`ISA1Q`（通常）。
 *
 * ★V5 227枚で 278回。共通メニューの次に多い部品。
 *
 * 形と色はここが持つ。**幅は持たない**。
 */
export function Tabs({
  items,
  actions,
  className,
  label,
  size,
  spacing,
  wrap = false,
}: {
  items: TabItem[]
  wrap?: boolean
  /**
   * タブ行の右端に置くもの。ヘッダー操作を独立した行にしないため
   * （`docs/v8-design-rules.md` §5、Pencil `aToSv` は space_between）。
   */
  actions?: ReactNode
  className?: string
  /**
   * タブの並び全体を読み上げる名前（Issue #708）。例:「配信の種類」。
   * 読み上げソフトが「○○のタブ一覧」と伝えられるようにする。
   */
  label?: string
  /**
   * 段の詰め方。省くと今までどおり（v8 は文字20＋下12）。
   * 'compact' は文字の行を詰めた段（E-1 hKRRF の店のタブ：高さ 30.5）。互換経路では効かない。
   */
  size?: 'compact' | 'settings' | 'short' | 'notification'
  /** 'settings' は設定の板のタブ間・下余白。指定した板だけに適用する。 */
  spacing?: 'compact' | 'settings'
}) {
  /*
   * Issue #708（監査6 a11y）: タブは見た目どおり tablist/tab の役割を持つ。
   * 選択中は aria-selected で伝え、Tabキーで入れるのは選択中の1つだけに
   * 絞る（roving tabindex）。左右の矢印キーで隣のタブへ移動できる
   * （フォーカスだけ動かし、開くのは Enter/Space/クリック＝手動起動型）。
   */
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    const { key } = event
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return
    const list = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')
    const tabs = Array.from(list)
    const current = tabs.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next =
      key === 'Home' ? 0
      : key === 'End' ? tabs.length - 1
      : key === 'ArrowRight' ? (current + 1) % tabs.length
      : (current - 1 + tabs.length) % tabs.length
    tabs[next]?.focus()
  }

  /*
   * 選択したタブの段へ共通FLIPで下線を移す（200ms）。
   * 測定前やサーバ描画では、選択したタブの枠線を下線として出す。
   */
  const itemsRef = useRef<HTMLSpanElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; selection: number } | null>(null)
  const currentKey = items.findIndex((item) => item.current)
  const itemWidthsKey = JSON.stringify(items.map(({ label, count, countTone, errorCount }) => [label, count, countTone, errorCount]))
  const indicatorRef = useRef(indicator)
  const queueMeasure = useRef<() => void>(() => {})
  const observerKey = JSON.stringify(items.map(({ label, id, href }) => [label, id, Boolean(href)]))
  useLayoutEffect(() => {
    let active = true
    const key = {}
    const commit = (next: { left: number; top: number; width: number; selection: number } | null) => {
      const previous = indicatorRef.current
      if (!active || (previous === null && next === null)
        || (previous !== null && next !== null && previous.left === next.left && previous.width === next.width && previous.selection === next.selection && previous.top === next.top)) return
      indicatorRef.current = next
      setIndicator(next)
    }
    const read = () => {
      if (!active) return () => {}
      const list = itemsRef.current
      const current = list?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!list || !current) return () => commit(null)
      const listBox = list.getBoundingClientRect()
      const tabBox = current.getBoundingClientRect()
      // A hidden copy has no usable geometry; retain the last visible underline until it reopens.
      if (listBox.width === 0 || tabBox.width === 0) return () => {}
      const next = { left: tabBox.left - listBox.left, top: Number.isFinite(tabBox.bottom - listBox.bottom) ? tabBox.bottom - listBox.bottom : 0, width: tabBox.width, selection: Array.from(list.querySelectorAll('[role="tab"]')).indexOf(current) }
      return () => commit(next)
    }
    const update = () => { if (active) scheduleMeasurement(key, read) }
    queueMeasure.current = update
    update()
    const list = itemsRef.current
    const stopObserving = observeElementResize(list ? [list, ...list.querySelectorAll<HTMLElement>('[role="tab"]')] : [], update)
    const fonts = document.fonts
    if (fonts?.status === 'loading') void fonts.ready.then(update)
    fonts?.addEventListener?.('loadingdone', update)
    window.addEventListener('resize', update)
    return () => {
      active = false
      if (queueMeasure.current === update) queueMeasure.current = () => {}
      cancelMeasurement(key)
      stopObserving()
      fonts?.removeEventListener?.('loadingdone', update)
      window.removeEventListener('resize', update)
    }
  }, [observerKey, wrap])
  useLayoutEffect(() => { queueMeasure.current() }, [currentKey, itemWidthsKey, wrap, size, spacing, className])
  const sliding = indicator !== null

  return (
    <nav className={[styles.list, className].filter(Boolean).join(' ')} data-size={size} data-spacing={spacing} data-wrap={wrap || undefined}>
      <span
        ref={itemsRef}
        className={styles.items}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-sliding={sliding || undefined}
        onKeyDown={moveFocus}
      >
        {sliding ? (
          <SlidingIndicator className={styles.indicator} left={indicator.left} top={indicator.top} width={indicator.width} selection={indicator.selection} />
        ) : null}
        {items.map((item, index) => (
          // 選択中のタブに Tab キーで入れるようにする（roving tabindex）。
          // どれも選ばれていないときは先頭が入口になる。
          <Tab
            key={item.label}
            {...item}
            tabIndex={item.current ? 0 : items.some((i) => i.current) ? -1 : index === 0 ? 0 : -1}
          />
        ))}
      </span>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </nav>
  )
}

function Tab({ id, controls, label, href, count, countTone, errorCount, current, disabled, disabledReason, onClick, tabIndex }: TabItem & { tabIndex: number }) {
  const reasonId = useId()
  const classes = [styles.tab, current && styles.current].filter(Boolean).join(' ')
  const body: ReactNode = (
    <>
      {label}
      {count === undefined ? null : <span className={styles.count} data-tone={countTone}>{count}</span>}
      {errorCount ? <ErrorCountBadge count={errorCount} label={label} /> : null}
    </>
  )
  /*
   * aria-current は見た目の選択位置を追う既存の印として残す
   * （scrollable-tabs がこの属性で選択中のタブへスクロールする）。
   * 選択の意味は role="tab" + aria-selected が持つ。
   */
  const shared = {
    id,
    'aria-controls': controls,
    className: classes,
    role: 'tab',
    'aria-selected': current ?? false,
    'aria-current': current ? ('page' as const) : undefined,
    tabIndex,
  }

  if (href && !current && !disabled) {
    return (
      <Link href={href} prefetch={false} replace {...shared}>
        {body}
      </Link>
    )
  }

  return (
    <><button
      type="button"
      {...shared}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      aria-describedby={disabled && disabledReason ? reasonId : undefined}
      onClick={onClick}
      /*
       * 選択中・onClick無しのタブは押せないが disabled にはしない。
       * disabled のボタンはフォーカスを受けられず、選択中のタブへ
       * Tab キーで入れなくなるため（Issue #708）。
       */
      disabled={disabled}
    >
      {body}
    </button>{disabled && disabledReason ? <span id={reasonId} className="sr-only">{disabledReason}</span> : null}</>
  )
}
