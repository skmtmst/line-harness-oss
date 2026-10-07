'use client'

import { ArrowUpRight } from 'lucide-react'
import React, { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import MenuPortal from './menu-portal'
import styles from './action-menu.module.css'

export type ActionMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  /**
   * 補足（★V7）。渡すと項目が2行・高さ52pxになる。
   * 例：「テンプレートを送る」＋「受信箱で選んで送ります」。
   */
  description?: string
  tone?: 'default' | 'danger'
  /**
   * 別画面へ行く項目（★V7）。右端に ↗ を出す。
   * 同じ画面の中の操作（モーダル・タブ切替）には付けない。
   */
  external?: boolean
  disabled?: boolean
  /**
   * #985 LAY-18: 押せない理由（使用中・公開中など）。無効な項目の下に
   * 小さく出す。理由が書けない操作は無効のまま黙って置かない。
   */
  disabledReason?: string
  dividerBefore?: boolean
  /**
   * 小さな見出し（★V7）。この項目の前に出す。
   * 同じ見出しを2回出さないのは呼ぶ側の責任。
   */
  sectionBefore?: string
  /**
   * 撮影の押し口（`data-qa-open`）。メニューの中の項目を開ける手順の
   * 印にする。1画面に1つだけ。
   */
  qaOpen?: string
  onSelect: () => void
}

export type ActionMenuProps = {
  open: boolean
  items: ActionMenuItem[]
  note?: string
  onClose: () => void
  ariaLabel?: string
  /** 参照画像の固定比較用。 */
  inline?: boolean
  /**
   * 開くボタン。渡すとメニューの位置の基準になり、ボタンの
   * 押し直しで閉じられる。渡さないときは直前のボタン要素を
   * 基準にする（`MoreAction`＋`ActionMenu` の並びが前提）。
   */
  anchorRef?: RefObject<HTMLElement | null>
}

/** Pencil ★V7 `xifuV` を正本にした小型操作メニュー（V5 `hGpFq` から移行）。 */
export default function ActionMenu({ open, items, note, onClose, ariaLabel = '操作', inline = false, anchorRef }: ActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const anchorMarkRef = useRef<HTMLSpanElement>(null)

  const getAnchor = () => {
    const explicit = anchorRef?.current
    if (explicit) return explicit
    const mark = anchorMarkRef.current
    if (!mark) return null
    // `MoreAction` 等の開くボタンの直後に置く並びが前提。
    // ボタンが無ければ目印自体を基準にする。
    const previous = mark.previousElementSibling
    return previous instanceof HTMLElement ? previous : mark
  }
  /*
   * 戻す先は押せる要素。位置の基準が囲み（右クリックの ContextMenu など）の
   * ときは、その中の開くボタンへ戻す。囲みへ focus() しても効かず BODY に落ちる。
   */
  const getFocusTarget = (): HTMLElement | null => {
    const anchor = getAnchor()
    if (!anchor) return null
    if (anchor.matches('button, a[href], [tabindex]:not([tabindex="-1"])')) return anchor
    const buttons = anchor.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')
    return buttons.length > 0 ? buttons[buttons.length - 1] : null
  }
  const getAnchorRef = useRef(getFocusTarget)
  getAnchorRef.current = getFocusTarget

  // 最上層（portal）では外側・Esc の扱いを MenuPortal に任せる。
  // 開くボタンの押し直しはトグル（閉じる）になる。
  useEffect(() => {
    if (!open || !inline) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [inline, onClose, open])

  /*
   * 開いたら最初の項目へフォーカスを入れる（WAI-ARIA のメニューの決まり）。
   * 最上層の器（MenuPortal）は、器が付いて位置を測るまで中身を描かない・
   * 隠しておくので、開いた直後の effect ではまだ項目が無い。描けて見えるまで
   * 数コマ待ってから入れる（以前はここで空振りして、矢印キーが効かなかった）。
   * 閉じたら、フォーカスが行き場を失っていれば開いたボタンへ戻す。
   * 項目から窓を開くときは、選んだ時点で開いたボタンへ戻してあるので、
   * 窓を閉じた後もそのボタンへ帰る（動きの点検 2・3 番）。
   */
  useEffect(() => {
    if (!open || inline) return
    const anchor = getAnchorRef.current()
    let frame = 0
    let tries = 0
    const focusFirst = () => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
      const host = menuRef.current?.closest<HTMLElement>('[data-menu-portal]')
      const hidden = !first || (host && host.style.visibility === 'hidden')
      if (!hidden && first) {
        first.focus({ preventScroll: true })
        return
      }
      tries += 1
      if (tries < 10) frame = requestAnimationFrame(focusFirst)
    }
    frame = requestAnimationFrame(focusFirst)
    return () => {
      cancelAnimationFrame(frame)
      const active = typeof document === 'undefined' ? null : document.activeElement
      const lost = !active || active === document.body || !active.isConnected || Boolean(menuRef.current?.contains(active))
      if (lost && anchor?.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [inline, open])

  if (!open) return null

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      // Tab はメニューを閉じて、開いたボタンの次（前）へ進む。既定の動きは止めない。
      getFocusTarget()?.focus({ preventScroll: true })
      onClose()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    if (buttons.length === 0) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length
    buttons[next].focus()
  }

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={`${styles.menu} ${inline ? styles.inline : styles.menuPortal}`}
      onKeyDown={moveFocus}
      /*
       * R13: メニューは行の中（tr の詳細遷移など）に置く。
       * 中の押下がそのまま行へ伝わると、選んだ操作の代わりに
       * 詳細へ移動してしまう。容器と項目の両方で止める。
       */
      onClick={(event) => event.stopPropagation()}
      data-design-part="action-menu"
      data-design-node="xifuV"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore ? <hr className={styles.divider} /> : null}
          {item.sectionBefore ? (
            <p className={styles.section} role="presentation">
              {item.sectionBefore}
            </p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${item.description || (item.disabled && item.disabledReason) ? styles.itemTall : ''} ${item.tone === 'danger' ? styles.danger : ''}`}
            disabled={item.disabled}
            title={item.label}
            data-qa-open={item.qaOpen}
            onClick={(event) => {
              event.stopPropagation()
              // 先に開いたボタンへ戻しておく。項目が窓を開くと、窓はこのボタンを
              // 「開く前の場所」として覚え、閉じた後にここへ戻す（消えた項目へは戻れない）。
              if (!inline) getFocusTarget()?.focus({ preventScroll: true })
              item.onSelect()
              onClose()
            }}
          >
            {item.icon ? <span className={styles.icon} aria-hidden="true">{item.icon}</span> : null}
            <span className={styles.itemBody}>
              <span className={styles.label}>{item.label}</span>
              {item.description ? (
                <span className={styles.description}>{item.description}</span>
              ) : null}
              {item.disabled && item.disabledReason ? (
                <span className={styles.reason}>{item.disabledReason}</span>
              ) : null}
            </span>
            {item.external ? (
              <ArrowUpRight size={14} aria-hidden="true" className={styles.externalIcon} />
            ) : null}
          </button>
        </div>
      ))}
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )

  // 参照画像の固定比較（`inline`）以外は、カード・表・ダイアログ・
  // 固定の帯の中でも切られないよう、最上層（portal）に出す。
  // 下に場所が無ければ上へ、右に無ければ左へ寄せる。
  if (inline) return menu
  return (
    <>
      <span ref={anchorMarkRef} aria-hidden="true" className={styles.anchor} />
      <MenuPortal open={open} getAnchor={getAnchor} onClose={onClose}>
        {menu}
      </MenuPortal>
    </>
  )
}
