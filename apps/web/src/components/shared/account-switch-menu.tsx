'use client'

import { Building2, Check, ArrowRight } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import MenuPortal from './menu-portal'
import styles from './account-switch-menu.module.css'

export interface AccountSwitchMenuAccount {
  id: string
  label: string
  mark?: string
}

export interface AccountSwitchMenuHq {
  /** 会社名（左メニューの頭と同じ）。 */
  companyName: string
  /** 統括に属するアカウントの数。 */
  accountCount: number
  onReturn: () => void
}

/**
 * ★V8 上の帯の「LINEアカウントの切り替え」を開いたときの一覧（絵 V8 `DIHFx/Psg7n`・オーナー 2026-10-07）。
 * 統括の権限がある人には、いちばん上に「統括に戻る」の行を置く。その下に店の一覧（選んでいる店に ✓）。
 * 最上層の器（MenuPortal）に出すので、帯の幅や重なりに切られない。v7 はブラウザの選ぶ欄のまま。
 */
export default function AccountSwitchMenu({
  open,
  onClose,
  getAnchor,
  accounts,
  selectedAccountId,
  onSelect,
  hq,
}: {
  open: boolean
  onClose: () => void
  getAnchor: () => HTMLElement | null
  accounts: AccountSwitchMenuAccount[]
  selectedAccountId: string
  onSelect: (accountId: string) => void
  hq?: AccountSwitchMenuHq | null
}) {
  const listId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // 開いたら、選んでいる行（無ければ先頭）へ焦点を移す。
  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => {
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])]
      const current = items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0]
      current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        getAnchor()?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, getAnchor])

  // 上下の矢印で行を移る。
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <MenuPortal open={open} getAnchor={getAnchor} align="end" onClose={onClose}>
      <div ref={panelRef} role="menu" aria-label="LINEアカウントの切り替え" className={styles.panel} onKeyDown={onKeyDown}>
        {hq ? (
          <>
            <button type="button" role="menuitem" className={styles.hqRow} onClick={() => { onClose(); hq.onReturn() }}>
              <Building2 aria-hidden="true" className={styles.hqIcon} />
              <span className={styles.hqText}>
                <span className={styles.hqTitle}>統括に戻る</span>
                <span className={styles.hqSub} title={hq.companyName}>{`${hq.companyName} ・ アカウント ${hq.accountCount}`}</span>
              </span>
              <ArrowRight aria-hidden="true" className={styles.hqArrow} />
            </button>
            <div className={styles.rule} role="separator" />
          </>
        ) : null}
        <p className={styles.heading} id={listId}>LINEアカウント</p>
        <div role="group" aria-labelledby={listId} className={styles.list}>
          {accounts.map((account) => {
            const selected = account.id === selectedAccountId
            return (
              <button
                key={account.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
                onClick={() => { onClose(); if (!selected) onSelect(account.id) }}
              >
                <span className={styles.mark} aria-hidden="true">{account.mark ?? account.label.slice(0, 1)}</span>
                <span className={styles.name} title={account.label}>{account.label}</span>
                {selected ? <Check aria-hidden="true" className={styles.check} /> : null}
              </button>
            )
          })}
        </div>
      </div>
    </MenuPortal>
  )
}
