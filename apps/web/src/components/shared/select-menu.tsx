'use client'

/*
 * ★V8 プルダウンの開いた中身（Pencil V8.pen 共通部品 StFE7「選ぶ欄/開いた」・
 * 参考は受信箱 jvb3W「5. 会話の頭のメニュー」。オーナー 2026-10-08・確認表 B-45）。
 *
 * - 白い地・薄い線・角丸 12・内側 6・行の間 2・浮きの影。影ごと器（MenuPortal）に持たせる
 *   （子に付けると器の overflow に切られる）。
 * - 任意で上に見出し（11px・ink-faint。例「並び」）。
 * - 行は 1 行のまま折り返さない。選んだ行は薄い地＋太字＋右端に ✓。
 * - 選択肢に「並び：」などの頭は付けない（頭は閉じたボタンの方だけ）。splitOptionHeads で外す。
 * - 幅はボタン以上・いちばん長い行に合わせる。ボタンの下 4px に出し、画面の端を越えるときは反対側へ。
 * - 開く 150ms（提案 F）。動きを減らす設定では動かさない。
 *
 * 開く・閉じる・キーボードは呼び出し側（shared/select）が持つ。ここは見た目と並びだけ。
 */
import { Check, Plus } from 'lucide-react'
import type { CSSProperties, FocusEvent, MouseEvent, ReactNode, Ref } from 'react'
import MenuPortal from './menu-portal'
import styles from './select-menu.module.css'

/** 行の高さ（32）＋行の間（2）。多い候補を間引いて描くときの1行分。globals の値と同じ。 */
export const SELECT_MENU_ROW_STRIDE = 34

/** 「並び：友だち順」の頭（「並び」）と中身（「友だち順」）を分ける。頭は 12 字まで。 */
const HEAD = /^([^：]{1,12})：(.+)$/

/**
 * 選択肢の頭（「並び：」など）を外して見出しにする。外すのは次の2つだけ。
 * - 全部の選択肢が同じ頭で始まる（「並び：友だち順」「並び：名前順」…）
 * - 先頭の1つだけが頭を持ち、ほかは持たない（「フォルダ：すべて」「お問い合わせ」「未分類」）
 * 頭の違う選択肢・頭を持つ選択肢が途中に混ざるとき（「動画だけ」と「並び：新しい順」など）は
 * 外さない（外すと何の選択肢か分からなくなる）。`label` を渡したときは、それが見出し。
 */
export function splitOptionHeads<T extends { label: string }>(
  options: readonly T[],
  label?: string,
): { heading: string | undefined; labelOf: (option: T) => string } {
  const keep = { heading: label || undefined, labelOf: (option: T) => option.label }
  if (options.length === 0) return keep
  const heads = options.map((option) => HEAD.exec(option.label)?.[1])
  const first = heads[0]
  if (!first) return keep
  const allSame = heads.every((head) => head === first)
  const onlyFirst = heads.slice(1).every((head) => head === undefined)
  if (!allSame && !onlyFirst) return keep
  if (label && label !== first) return keep
  return {
    heading: first,
    labelOf: (option: T) => HEAD.exec(option.label)?.[2] ?? option.label,
  }
}

export interface SelectMenuProps {
  open: boolean
  getAnchor: () => HTMLElement | null
  onClose: () => void
  /** 一覧の id（ボタンの aria-controls が指す）。 */
  listboxId: string
  /** 一覧の名前を持つ要素（ふつうは開くボタン）。 */
  labelledBy?: string
  ariaLabel?: string
  /** 上の小さな見出し（例「並び」）。無ければ出さない。 */
  heading?: string
  listRef?: Ref<HTMLUListElement>
  /** 中身の板（白い地の内側）。焦点が板の中にあるかを呼び出し側が見るため。 */
  innerRef?: Ref<HTMLDivElement>
  /**
   * 一覧の下に区切りの線を引いて置く行（dLffh「＋ 新しいフォルダを作る」。SelectMenuAction）。
   */
  footer?: ReactNode
  /**
   * 渡すと、同じ板の中身をこれに替える（iBuZH「名前を入れる」）。見出し・一覧・footer は出さない。
   * 中の入力欄に焦点を移せるよう、押す前の焦点の止めはしない。
   */
  panel?: ReactNode
  /** 板の中から焦点が外へ出たとき（Tab で抜けたなど）。 */
  onPanelBlur?: (event: FocusEvent<HTMLDivElement>) => void
  /** Esc で閉じずに別のことをするとき（panel から一覧へ戻る）。 */
  onEscape?: () => void
  children: ReactNode
}

export function SelectMenu({
  open,
  getAnchor,
  onClose,
  listboxId,
  labelledBy,
  ariaLabel,
  heading,
  listRef,
  innerRef,
  footer,
  panel,
  onPanelBlur,
  onEscape,
  children,
}: SelectMenuProps) {
  return (
    <MenuPortal
      open={open}
      align="start"
      matchWidth="min"
      getAnchor={getAnchor}
      onClose={onClose}
      onEscape={onEscape}
      className={styles.surface}
    >
      {panel ? (
        <div
          ref={innerRef}
          id={listboxId}
          className={styles.panel}
          data-select-menu=""
          data-select-menu-panel=""
          // 入力欄の焦点を板の空き・ボタンを押しても動かさない（押した拍子に閉じない）。
          onMouseDown={(event: MouseEvent) => {
            if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
          }}
          onBlur={onPanelBlur}
        >
          {panel}
        </div>
      ) : (
      /* 欄に焦点を残したまま押せるよう、押す前に焦点を移さない。 */
      <div ref={innerRef} className={styles.inner} onMouseDown={(event: MouseEvent) => event.preventDefault()} data-select-menu="">
        {heading ? (
          <div className={styles.heading} aria-hidden="true">
            {heading}
          </div>
        ) : null}
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : ariaLabel}
          className={styles.list}
        >
          {children}
        </ul>
        {footer ? (
          <>
            <div className={styles.divider} aria-hidden="true" />
            {footer}
          </>
        ) : null}
      </div>
      )}
    </MenuPortal>
  )
}

export interface SelectMenuOptionProps {
  label: string
  selected: boolean
  active?: boolean
  disabled?: boolean
  /** 行の先頭の印（状態の色の点など）。 */
  leading?: ReactNode
  onSelect: () => void
  onHover?: () => void
  setSize?: number
  posInSet?: number
}

export function SelectMenuOption({
  label,
  selected,
  active = false,
  disabled = false,
  leading,
  onSelect,
  onHover,
  setSize,
  posInSet,
}: SelectMenuOptionProps) {
  return (
    <li role="option" aria-selected={selected} aria-setsize={setSize} aria-posinset={posInSet} className={styles.row}>
      <button
        type="button"
        className={styles.item}
        disabled={disabled}
        data-selected={selected || undefined}
        data-active={active || undefined}
        onMouseEnter={onHover}
        onClick={onSelect}
        title={label}
      >
        {leading ? <span className={styles.leading} aria-hidden="true">{leading}</span> : null}
        <span className={styles.label}>{label}</span>
        {selected ? <Check className={styles.check} aria-hidden="true" /> : null}
      </button>
    </li>
  )
}

export interface SelectMenuActionProps {
  label: string
  active?: boolean
  onSelect: () => void
  onHover?: () => void
}

/** 一覧の下の「＋ 〇〇」（dLffh「新しく作る」）。緑・600。選択肢ではないので listbox の外に置く。 */
export function SelectMenuAction({ label, active = false, onSelect, onHover }: SelectMenuActionProps) {
  return (
    <button
      type="button"
      className={`${styles.item} ${styles.action}`}
      data-active={active || undefined}
      data-select-menu-action=""
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <span className={styles.leading} aria-hidden="true"><Plus className={styles.actionIcon} /></span>
      <span className={styles.label}>{label}</span>
    </button>
  )
}

/** 多い候補を間引くときの上下の詰め物（読み上げには出さない）。 */
export function SelectMenuSpacer({ rows }: { rows: number }) {
  const style: CSSProperties = { height: rows * SELECT_MENU_ROW_STRIDE }
  return <li role="presentation" aria-hidden="true" className={styles.spacer} style={style} />
}
