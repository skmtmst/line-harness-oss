'use client'

import { useEffect, useRef } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'

export default function StyleChooseAction({ viewing, chosen, onChoose, disabled, primary = false }: {
  viewing: AccountStyle; chosen: AccountStyle | null; onChoose: (style: AccountStyle) => void; disabled: boolean; primary?: boolean
}) {
  const selectedRef = useRef<HTMLSpanElement>(null)
  const selectedButtonRef = useRef<HTMLButtonElement>(null)
  const pending = useRef<AccountStyle | null>(null)
  useEffect(() => {
    if (pending.current === chosen && chosen === viewing) { (selectedButtonRef.current ?? selectedRef.current)?.focus(); pending.current = null }
  }, [chosen, viewing])
  if (chosen === viewing && primary) return <Button ref={selectedButtonRef} variant="primary" aria-disabled="true">選んでいます</Button>
  return chosen === viewing
    ? <span ref={selectedRef} tabIndex={-1}><StatusBadge tone="success" dot>選んでいます</StatusBadge></span>
    : <Button id={primary ? undefined : 'style-choice-pick'} variant={primary ? 'primary' : 'secondary'} onClick={() => { pending.current = viewing; onChoose(viewing) }} disabled={disabled}>このスタイルにする</Button>
}
