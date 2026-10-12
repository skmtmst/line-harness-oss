'use client'
import type React from 'react'

import { useRef, useState, useLayoutEffect, Fragment, Children, isValidElement, cloneElement, createContext, useContext, type ReactNode, type HTMLAttributes } from 'react'
import Select, { type SelectProps } from './select'
import SearchField from './search-field'
import FilterChip from './filter-chip'
import PageSizeSelect from './page-size-select'
import styles from './list-toolbar.module.css'

/** 一覧型が狭い板の「作る・フォルダ」を検索と同じ段へ渡す。 */
const LeadingContext = createContext<ReactNode>(null)
const FrameContext = createContext(false)
export function ListToolbarLeading({ children, leading }: { children: ReactNode; leading: ReactNode }) {
  // 旧い断片の道具も、型の口で役目をそろえる。フォームのRowはそのまま保つ。
  const nodes = isValidElement<{ children?: ReactNode }>(children) && children.type === Fragment ? Children.toArray(children.props.children) : null
  const containsLayout = (items: ReactNode[]): boolean => items.some(node => isValidElement<{ children?: ReactNode }>(node)
    && (node.type === ListToolbar || node.type === ListToolbarFrame || node.type === Fragment && containsLayout(Children.toArray(node.props.children))))
  const needsFrame = nodes && nodes.some(node => isValidElement(node) && node.type === ListToolbarRow) && !containsLayout(nodes)
  const tools = needsFrame ? <ListToolbarFrame>{nodes.map((node, index) => isValidElement(node) && node.type === ListToolbarRow
    ? node : <ListToolbarRow key={isValidElement(node) ? node.key ?? index : index}>{node}</ListToolbarRow>)}</ListToolbarFrame> : children
  return <LeadingContext.Provider value={leading}>{tools}</LeadingContext.Provider>
}

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
  const leading = useContext(LeadingContext)
  return (
    <div className={styles.toolbar} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout={layout} style={search?.width ? ({ '--list-search-width': `${search.width}px` } as React.CSSProperties) : undefined}>
      <div className={styles.row1} data-toolbar-tools>
        {leading ? <span className={styles.leading} data-toolbar-leading>{leading}</span> : null}
        {search ? <div className={styles.search} data-toolbar-search><SearchField
          placeholder={search.placeholder}
          aria-label={search.label ?? search.placeholder}
          value={search.value}
          onChange={search.onChange}
          onClear={() => search.onChange('')}
          maxLength={search.maxLength}
          loading={search.loading}
        /></div> : searchSlot ? <div className={styles.search} data-toolbar-search>{searchSlot}</div> : null}
      </div>
      {filters || secondary || actions || trailing || sort ? (
        <div className={styles.row2}>
          {filters || secondary ? <div className={styles.filters} data-toolbar-tools>{compactFilterGroups(filters)}{secondary}</div> : null}
          {actions ? <span className={styles.actions} data-toolbar-actions>{actions}</span> : null}
          {trailing || sort ? <div className={styles.trailing} data-toolbar-tools data-toolbar-trailing>{sort ? <ListToolbarSort {...sort} /> : null}{trailing}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** 検索の送信・保存条件などを持つ一覧でも、段の見た目を画面に持たせない。 */
export function ListToolbarFrame({ children, layout = 'band', ...props }: HTMLAttributes<HTMLDivElement> & { layout?: 'band' | 'stacked' }) {
  const leading = useContext(LeadingContext)
  return <FrameContext.Provider value><div {...props} className={styles.slots} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout={layout === 'stacked' ? 'slots-stacked' : 'slots'}>
    {leading ? <span className={styles.leading} data-toolbar-leading>{leading}</span> : null}
    <span className={styles.rowBreak} aria-hidden="true" />{children}
  </div></FrameContext.Provider>
}

export function ListToolbarRow({ children, as: Tag = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'form' }) {
  const leading = useContext(LeadingContext)
  const inFrame = useContext(FrameContext)
  return <Tag {...props} className={styles.slotsRow} data-shared-part="list-toolbar" data-list-toolbar data-toolbar-layout="slots-row" data-toolbar-tools>
    {!inFrame && leading ? <span className={styles.leading} data-toolbar-leading>{leading}</span> : null}
    {!inFrame ? <span className={styles.rowBreak} aria-hidden="true" /> : null}
    {Children.toArray(compactFilterGroups(children)).map((child, index) => <span key={isValidElement(child) ? child.key ?? index : index} className={styles.slotTool} data-toolbar-role={toolbarRole(child)}>{child}</span>)}
  </Tag>
}

/** 保存検査の包みを含め、部品の役目から並べる。画面CSSで順序を上書きしない。 */
function toolbarRole(node: ReactNode): 'search' | 'filter' | 'sort' | 'count' {
  if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string; label?: string }>(node)) return 'filter'
  if (node.type === ListToolbarSearchSlot || node.type === SearchField) return 'search'
  if (node.type === PageSizeSelect) return 'count'
  if (node.type === ListToolbarSort) return 'sort'
  if (/表示件数|1ページ|件表示/.test(node.props['aria-label'] ?? node.props.label ?? '')) return 'count'
  if (/並び/.test(node.props['aria-label'] ?? node.props.label ?? '')) return 'sort'
  const roles = Children.toArray(node.props.children).map(toolbarRole)
  return roles.find(role => role !== 'filter') ?? 'filter'
}

export function ListToolbarSearchSlot({ children }: { children: ReactNode }) {
  return <div className={styles.searchSlot} data-toolbar-search>{children}</div>
}

export function ListToolbarEnd({ children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={styles.slotsEnd} data-toolbar-trailing>{children}</span>
}

/** B-244：省略記号へ畳まず、操作名を持つ元の道具を表示する。 */
export function ListToolbarOptional({ children }: { children: ReactNode; label?: string; compact?: boolean }) {
  return <span className={styles.optional} data-toolbar-optional>{children}</span>
}

export type ListToolbarSortProps = Omit<SelectProps, 'aria-label' | 'label'> & { label?: string; 'aria-label'?: string }
/** 並びの名前と選ぶ操作はこの欄にそろえる。 */
export function ListToolbarSort(props: ListToolbarSortProps) {
  return <span data-list-sort><Select {...props} label="並び" aria-label="並び" /></span>
}

/** B-191/192/205：入らない札と狭い列だけを選ぶ欄へ畳む。 */
function compactFilterGroups(node: ReactNode): ReactNode {
  const children = Children.toArray(node)
  if (children.length > 1 && children.every(child => isValidElement(child) && child.type === FilterChip))
    return <ResponsiveFilterChips>{children}</ResponsiveFilterChips>
  return children.map(child => isValidElement<{ children?: ReactNode }>(child) && child.props.children && (typeof child.type === 'string' || child.type === Fragment)
    ? cloneElement(child, {}, compactFilterGroups(child.props.children)) : child)
}
export function ResponsiveFilterChips({ children, label = '状態' }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const unfoldedWidth = useRef(0)
  const [collapsed, setCollapsed] = useState(false)
  useLayoutEffect(() => {
    const choices = ref.current
    const toolbar = choices?.closest<HTMLElement>('[data-toolbar-layout="band"], [data-toolbar-layout="slots"], [data-toolbar-layout="stacked"], [data-toolbar-layout="slots-stacked"]')
    if (!choices || !toolbar || !window.ResizeObserver || toolbar.dataset.toolbarLayout?.includes('stacked')) return
    const flatten = (element: HTMLElement): HTMLElement[] => getComputedStyle(element).display === 'contents'
      ? [...element.children].flatMap(child => flatten(child as HTMLElement)) : [element]
    const measure = () => {
      if (document.documentElement.dataset.theme !== 'v8') return
      const wide = choices.querySelector<HTMLElement>('[data-filter-chips]')!
      if (wide.getBoundingClientRect().width > 0) unfoldedWidth.current = Math.max(wide.scrollWidth, wide.getBoundingClientRect().width)
      choices.dataset.filterWidth = String(unfoldedWidth.current)
      const tools = [...toolbar.children].flatMap(child => flatten(child as HTMLElement)).filter(tool =>
        getComputedStyle(tool).display !== 'none' && getComputedStyle(tool).flexGrow === '0'
        && !tool.matches('[data-shared-part="notice"], :has(> [data-shared-part="notice"])'))
      const required = tools.reduce((sum, tool) => {
        let width = tool.getBoundingClientRect().width
        for (const group of tool.matches('[data-filter-width]') ? [tool] : [...tool.querySelectorAll<HTMLElement>('[data-filter-width]')]) {
          width += Math.max(0, Number(group.dataset.filterWidth) - group.getBoundingClientRect().width)
        }
        return sum + width
      }, 0)
      const css = getComputedStyle(toolbar)
      const available = toolbar.clientWidth - parseFloat(css.paddingLeft || '0') - parseFloat(css.paddingRight || '0')
      setCollapsed(required + (parseFloat(css.columnGap) || 0) * Math.max(0, tools.length - 1) > available + 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar); observer.observe(choices)
    measure()
    return () => observer.disconnect()
  }, [children])
  const chips = Children.toArray(children).filter(isValidElement<React.ComponentProps<typeof FilterChip>>)
  const text = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('')
  const selected = chips.map((child,index) => child.props.selected ? index : -1).filter(index => index >= 0)
  const allIndex = chips.findIndex(child => /^すべて(?:$|\s|[\d（(])/.test(text(child.props.children)))
  const current = selected.length > 1 ? 'multiple' : selected.length === 1 ? String(selected[0]) : allIndex >= 0 ? String(allIndex) : 'all'
  return <span ref={ref} className={styles.filterChoices} data-filter-collapsed={collapsed || undefined}>
    <span className={styles.filterWide} data-filter-chips>{children}</span>
    <span className={styles.filterNarrow}><Select label={label} aria-label={label} value={current}
      options={[...(allIndex >= 0 ? [] : [{ value: 'all', label: 'すべて', disabled: selected.length > 1 }]), ...(selected.length > 1 ? [{ value: 'multiple', label: `${selected.length}件の条件`, disabled: true }] : []), ...chips.map((child,index) => ({ value: String(index), label: text(child.props.children), disabled: child.props.disabled }))]}
      onChange={next => { if (next === 'all') { if (selected.length === 1) chips[selected[0]].props.onChange(false) } else { const chip = chips[Number(next)]; chip?.props.onChange(!chip.props.selected) } }} /></span>
  </span>
}
