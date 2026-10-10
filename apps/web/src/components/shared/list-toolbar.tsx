'use client'
import type React from 'react'

import { Fragment, Children, isValidElement, cloneElement, useLayoutEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react'
import Select, { type SelectProps } from './select'
import SearchField from './search-field'
import FilterChip from './filter-chip'
import styles from './list-toolbar.module.css'

export type ListToolbarSearch = {
  placeholder: string
  value: string
  onChange: (value: string) => void
  /**
   * 読み上げ名。渡さないときは placeholder と同じ文にする
   * （検索欄は見た目に常設ラベルが無いため）。
   */
  label?: string
  /** 入力の上限（貼り付けの制限）。渡さないときは付けない。 */
  maxLength?: number
  /** ★V8 探す欄の幅（板ごとの絵の幅。例：リマインダ apLqS は 200）。渡さないときは部品の 280。 */
  width?: number
  /** 検索中。渡すと虫眼鏡の代わりに回る印が出る。 */
  loading?: boolean
}

/**
 * 一覧の上の道具の並び。★V7 `Xn1Mz`。
 *
 * どの一覧も同じ2行にする。画面ごとに手で並べない。
 *
 * - 1行目：検索（幅320・虫眼鏡つき・狭い時も240まで）→ `actions`
 *   （保存した検索・この条件を保存）。検索を横いっぱいに伸ばさない。
 *   検索を枠付きの箱（カード）で包まない。
 * - 2行目：左に `filters`（札・日付などの絞り込み）、右端に
 *   `trailing`（並び順と表示件数）。表示件数だけの行を作らない。
 *   入りきらない幅では右の2つが下へ折り返す。
 *
 * 画面の上からの順もそろえる：数のカード → 説明の開閉（Disclosure）→
 * ＋ ○○を作る（左）→ この部品 → フォルダと表。
 */
export default function ListToolbar({
  search,
  searchSlot,
  actions,
  filters,
  trailing,
  secondary,
  sort,
  layout = 'band',
}: {
  sort?: ListToolbarSortProps
  search?: ListToolbarSearch
  /** 既存の検索フォームの動きを保って共通の段へ移す口。 */
  searchSlot?: ReactNode
  /** 1行目。検索の右に置く、動くものだけ（保存した検索・この条件を保存）。 */
  actions?: ReactNode
  /** 2行目・左。札・日付などの絞り込み。 */
  filters?: ReactNode
  /** 2行目・右端。並び順と表示件数。 */
  trailing?: ReactNode
  /** 友だち・一斉配信の状態など、足してよい2段目。 */
  secondary?: ReactNode
  /**
   * 並べ方。既定 'band' は1本の帯（c4n9Kr）。
   * 'stacked' は2段（acRIl 予約管理：1段目＝探す・担当・経路・CSV、
   * 2段目＝札）。段の間10・段の中の間6。
   */
  layout?: 'band' | 'stacked'
}) {
  return (
    <div className={styles.toolbar} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout={layout} style={search?.width ? ({ '--list-search-width': `${search.width}px` } as React.CSSProperties) : undefined}>
      <div className={styles.row1} data-toolbar-tools>
        {search ? <div className={styles.search} data-toolbar-search><SearchField
          placeholder={search.placeholder}
          aria-label={search.label ?? search.placeholder}
          value={search.value}
          onChange={search.onChange}
          onClear={() => search.onChange('')}
          maxLength={search.maxLength}
          loading={search.loading}
        /></div> : searchSlot ? <div className={styles.search} data-toolbar-search>{searchSlot}</div> : null}
        {actions}
      </div>
      {filters || trailing || sort ? (
        <div className={styles.row2}>
          {filters ? <div className={styles.filters} data-toolbar-tools>{compactFilterGroups(filters)}</div> : null}
          {trailing || sort ? <div className={styles.trailing} data-toolbar-tools>{sort ? <ListToolbarSort {...sort} /> : null}{trailing}</div> : null}
        </div>
      ) : null}
      {secondary ? <div className={styles.secondary} data-toolbar-secondary>{secondary}</div> : null}
    </div>
  )
}

/** 検索の送信・保存条件などを持つ一覧でも、段の見た目を画面に持たせない。 */
export function ListToolbarFrame({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={styles.slots} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout="slots">{children}</div>
}

export function ListToolbarRow({ children, as: Tag = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'form' }) {
  return <Tag {...props} className={styles.slotsRow} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout="slots-row" data-toolbar-tools>{children}</Tag>
}

export function ListToolbarSearchSlot({ children }: { children: ReactNode }) {
  return <div className={styles.searchSlot} data-toolbar-search>{children}</div>
}

export function ListToolbarEnd({ children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={styles.slotsEnd}>{children}</span>
}

/** 優先度の低い道具。帯に入らないときだけ「…」から同じ操作へ到達する。 */
export function ListToolbarOptional({ children, label = 'ほかの絞り込み', compact = false }: { children: ReactNode; label?: string; compact?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const expandedWidthRef = useRef(0)
  const [collapsed, setCollapsed] = useState(compact)
  useLayoutEffect(() => {
    const item = ref.current, toolbar = item?.closest<HTMLElement>('[data-list-toolbar]')
    if (!item || !toolbar || !window.ResizeObserver || compact) return
    const measure = () => {
      if (document.documentElement.dataset.theme !== 'v8') return
      const content = item.querySelector<HTMLElement>('[data-toolbar-optional-content]')!
      if (!item.hasAttribute('data-collapsed')) expandedWidthRef.current = content.getBoundingClientRect().width
      const tools = [...toolbar.querySelectorAll<HTMLElement>('[data-toolbar-tools]')].flatMap((group) => [...group.children] as HTMLElement[])
      const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 0
      const required = tools.reduce((width, tool) => width + (tool === item ? expandedWidthRef.current : tool.getBoundingClientRect().width), 0) + gap * Math.max(0, tools.length - 1)
      setCollapsed(required > toolbar.clientWidth)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    for (const group of toolbar.querySelectorAll('[data-toolbar-tools]')) for (const tool of group.children) observer.observe(tool)
    measure()
    return () => observer.disconnect()
  }, [children, compact])
  return <details ref={ref} className={styles.optional} data-toolbar-tool data-toolbar-optional data-collapsed={collapsed || undefined} open={collapsed ? undefined : true}
    onKeyDown={(event) => { if (event.key === 'Escape' && collapsed) { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}
    onBlur={(event) => { if (collapsed && !event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }}>
    <summary aria-label={label} title={label}>…</summary>
    <div data-toolbar-optional-content>{children}</div>
  </details>
}

export type ListToolbarSortProps = Omit<SelectProps, 'aria-label' | 'label'> & { label?: string; 'aria-label'?: string }
/** 並びの名前と選ぶ操作はこの欄にそろえる。 */
export function ListToolbarSort(props: ListToolbarSortProps) {
  return <span data-list-sort><Select {...props} label="並び" aria-label="並び" /></span>
}

/** B-205：札の集まりだけを状態の選ぶ欄へ畳む。日付・複数条件は元の操作を保つ。 */
function compactFilterGroups(node: ReactNode): ReactNode {
  const children = Children.toArray(node)
  if (children.length > 1 && children.every(child => isValidElement(child) && child.type === FilterChip))
    return <ResponsiveFilterChips>{children}</ResponsiveFilterChips>
  return children.map(child => isValidElement<{ children?: ReactNode }>(child) && child.props.children && (typeof child.type === 'string' || child.type === Fragment)
    ? cloneElement(child, {}, compactFilterGroups(child.props.children)) : child)
}
export function ResponsiveFilterChips({ children, label = '状態' }: { children: ReactNode; label?: string }) {
  const chips = Children.toArray(children).filter(isValidElement<React.ComponentProps<typeof FilterChip>>)
  const text = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('')
  const current = chips.findIndex(child => child.props.selected)
  return <span className={styles.filterChoices}>
    <span className={styles.filterWide}>{children}</span>
    <span className={styles.filterNarrow}><Select label={label} aria-label={label} value={String(current < 0 ? 0 : current)}
      options={chips.map((child,index) => ({ value: String(index), label: text(child.props.children), disabled: child.props.disabled }))}
      onChange={next => chips[Number(next)]?.props.onChange(true)} /></span>
  </span>
}
