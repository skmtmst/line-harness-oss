'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import type { DrawerProps } from '@/components/shared/drawer'
import './order-drawer-v8.css'

/** 注文の閲覧だけで使う引き出し。共通Drawerは変更しない。 */
export default function OrderDrawerV8({ open, title, description, onClose, children, footer, busy }: DrawerProps) {
  const id = useId()
  const ref = useOverlayFocus(open, onClose, busy)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!open) return null
  const panel = <div className="v8-ro-order-overlay" role="presentation" data-design-node="nAesv" onMouseDown={event => {if (!busy && event.target === event.currentTarget) onClose()}}><aside className="v8-ro-order-drawer" role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy || undefined} ref={ref} tabIndex={-1}><header><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" aria-label="閉じる" onClick={onClose} disabled={busy}><X aria-hidden="true" size={18} /></button></header><div className="v8-ro-order-body">{children}</div>{footer && <footer>{footer}</footer>}</aside></div>
  return mounted ? createPortal(panel, document.body) : panel
}
