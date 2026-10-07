'use client'

import { ArrowUpDown, Check, ChevronDown, ChevronUp } from 'lucide-react'
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import MenuPortal from './menu-portal'
import styles from './select.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  'aria-label': string
  className?: string
  defaultOpen?: boolean
  disabled?: boolean
  error?: string
  id?: string
  label?: string
  name?: string
  onChange: (value: string) => void
  options: SelectOption[]
  size?: 'standard' | 'page-size' | 'full'
  value: string
  /**
   * 箱の幅（px）。渡すと size の幅を上書きする
   * （x6QsVz の絞り込み欄 122〜136 など板ごとの絵幅）。
   */
  width?: number
  /**
   * 見せ方。既定 'box' は枠の箱。'text' は枠なし文字＋上下矢印
   * （x6QsVz の並び替えどおり）。v8 だけで枠を消す。
   */
  treatment?: 'box' | 'text'
  /**
   * 箱の先頭の図柄（v19Ivv のよく使う絞り込みの栞どおり）。
   * 渡さなければ出ない。
   */
  icon?: ReactNode
}

/*
 * 候補が多い（タグ 2,000 個など）ときは、開いた一覧のうち見えている所の前後だけ描く
 * （2026-10-07 速さ。全部描くと 2,000 個で 8,000 要素・開くまで 0.4 秒）。
 * 行の高さは 38px で決まっているので、位置は計算で出す。
 * 読み上げには「全 n 件中 m 件目」を aria-setsize / aria-posinset で渡す。
 * キーボードで動かした先が描かれていなければ、そこまでスクロールしてから描く。
 */
const WINDOW_THRESHOLD = 100
const OPTION_HEIGHT = 38
const WINDOW_OVERSCAN = 12

/** Pencil V5 `rpot9` / `Gfsb4` を正本にした単一選択。 */
export default function Select({
  'aria-label': ariaLabel,
  className,
  defaultOpen = false,
  disabled = false,
  error,
  id,
  label,
  name,
  onChange,
  icon,
  options,
  size = 'standard',
  value,
  width,
  treatment = 'box',
}: SelectProps) {
  const generatedId = useId()
  const buttonId = id ?? `${generatedId}-button`
  const listboxId = `${generatedId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const enabledOptions = options.filter((option) => !option.disabled)
  const selectedIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const selected = options.find((option) => option.value === value) ?? options[0]
  // 候補ごとに「使える候補の中で何番目か」を1回で引く（行ごとに探すと 2,000 個で 400 万回）。
  const enabledIndexOf = useMemo(() => {
    const map = new Map<string, number>()
    enabledOptions.forEach((option, index) => map.set(option.value, index))
    return map
  }, [enabledOptions])
  const windowed = options.length > WINDOW_THRESHOLD
  // 一覧は器（MenuPortal）が後から描くので、ref ではなく描かれた時に受け取る。
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null)
  const [scrollWindow, setScrollWindow] = useState({ top: 0, height: 0 })

  // 開いている間、器（MenuPortal）のスクロールを追う。
  useLayoutEffect(() => {
    if (!open || !windowed) return
    const list = listEl
    const scroller = list?.closest<HTMLElement>('[data-menu-portal]')
    if (!list || !scroller) return
    let frame = 0
    const read = () => {
      frame = 0
      const top = scroller.scrollTop - list.offsetTop
      const height = scroller.clientHeight || 400
      setScrollWindow((prev) => (prev.top === top && prev.height === height ? prev : { top, height }))
    }
    // 開いたときは選んでいる候補が見える所から。
    const selectedAt = options.findIndex((option) => option.value === value)
    if (selectedAt > 0) scroller.scrollTop = list.offsetTop + selectedAt * OPTION_HEIGHT
    read()
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, windowed, listEl])

  // キーボードで動かした候補が見える所にあるようにする（描かれていなければ描いてから）。
  useLayoutEffect(() => {
    if (!open || !windowed) return
    const list = listEl
    const scroller = list?.closest<HTMLElement>('[data-menu-portal]')
    const option = enabledOptions[activeIndex]
    if (!list || !scroller || !option) return
    const at = options.findIndex((candidate) => candidate.value === option.value)
    const top = list.offsetTop + at * OPTION_HEIGHT
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (top + OPTION_HEIGHT > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + OPTION_HEIGHT - scroller.clientHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open, windowed, listEl])

  let windowStart = 0
  let windowEnd = options.length
  if (open && windowed) {
    const height = scrollWindow.height || 400
    windowStart = Math.max(0, Math.floor(scrollWindow.top / OPTION_HEIGHT) - WINDOW_OVERSCAN)
    windowEnd = Math.min(options.length, Math.ceil((scrollWindow.top + height) / OPTION_HEIGHT) + WINDOW_OVERSCAN)
  }

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    setActiveIndex(selectedIndex)
  }, [selectedIndex])

  const choose = (option: SelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const move = (direction: 1 | -1) => {
    if (enabledOptions.length === 0) return
    setActiveIndex((current) => (current + direction + enabledOptions.length) % enabledOptions.length)
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open && enabledOptions[activeIndex]) choose(enabledOptions[activeIndex])
      else setOpen(true)
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={[
        styles.root,
        styles[size === 'page-size' ? 'pageSize' : size],
        open ? styles.open : null,
        disabled ? styles.disabled : null,
        error ? styles.invalid : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
      data-design-node={open ? 'Gfsb4' : size === 'page-size' ? 'niGPF' : 'rpot9'}
    >
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        className={`${styles.trigger} ${open ? styles.openTrigger : styles.closedTrigger} ${treatment === 'text' ? styles.textTrigger : ''}`}
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={Boolean(error) || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        {treatment === 'text' ? (
          <ArrowUpDown className={styles.directionIcon} aria-hidden="true" />
        ) : null}
        {icon ? (
          <span className={styles.leadingIcon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {/* 省略表示（…）のとき、ホバーで全文を確認できる（#640）。 */}
        <span className={styles.value} title={selected?.label ?? undefined}>
          {label ? `${label}：` : ''}{selected?.label ?? ''}
        </span>
        {open ? (
          <ChevronUp className={styles.chevron} aria-hidden="true" />
        ) : (
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <MenuPortal
          open={open}
          align="start"
          matchWidth
          getAnchor={() => triggerRef.current}
          onClose={() => setOpen(false)}
        >
          <ul
            ref={setListEl}
            id={listboxId}
            role="listbox"
            aria-labelledby={buttonId}
            className={styles.listbox}
            // 最上層では absolute 指定を無効にする（位置は器が決める）。
            // 欄に焦点を残したまま押せるよう、押す前に焦点を移さない。
            style={{ position: 'static', width: '100%' }}
            onMouseDown={(event) => event.preventDefault()}
          >
          {windowStart > 0 ? <li role="presentation" aria-hidden="true" style={{ height: windowStart * OPTION_HEIGHT }} /> : null}
          {options.slice(windowStart, windowEnd).map((option, offset) => {
            const optionIndex = enabledIndexOf.get(option.value) ?? -1
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                aria-setsize={windowed ? options.length : undefined}
                aria-posinset={windowed ? windowStart + offset + 1 : undefined}
              >
                <button
                  type="button"
                  className={`${styles.option} ${isSelected ? `${styles.selected} ${styles.selectedBackground}` : ''}`}
                  disabled={option.disabled}
                  data-active={optionIndex === activeIndex || undefined}
                  onMouseEnter={() => {
                    if (optionIndex >= 0) setActiveIndex(optionIndex)
                  }}
                  onClick={() => choose(option)}
                >
                  <span className={`${styles.check} ${isSelected ? styles.checked : ''}`}>
                    {isSelected ? <Check className={styles.checkIcon} aria-hidden="true" /> : null}
                  </span>
                  <span>{option.label}</span>
                </button>
              </li>
            )
          })}
          {windowEnd < options.length ? <li role="presentation" aria-hidden="true" style={{ height: (options.length - windowEnd) * OPTION_HEIGHT }} /> : null}
          </ul>
        </MenuPortal>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  )
}
