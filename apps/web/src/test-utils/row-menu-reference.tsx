import { MoreHorizontal } from 'lucide-react'
import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from 'react'
import ActionMenu, { orderActionMenuItems, type ActionMenuItem } from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import styles from '@/components/shared/row-actions.module.css'

/** 指定なしの入口の公開DOMを比較する参照。製品からは使わない。 */
type Base = { className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

function ReferenceIcon({
  label,
  tone,
  grip,
  className,
  buttonRef,
  children,
  ...rest
}: Base & { label: string; tone?: 'danger'; grip?: boolean; buttonRef?: RefObject<HTMLButtonElement | null>; children: ReactNode }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      data-hit-area={grip ? '' : undefined}
      className={[styles.action, tone === 'danger' && styles.danger, grip && styles.grip, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}


function ReferenceMoreAction({ label = 'そのほかの操作', buttonRef, ...rest }: Base & { label?: string; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <ReferenceIcon label={label} buttonRef={buttonRef} {...rest}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </ReferenceIcon>
  )
}


type RowMenuTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-haspopup' | 'aria-label' | 'children' | 'className' | 'onClick' | 'type'
> & {
  [key: `data-${string}`]: string | undefined
}

export type ReferenceProps = {
  
  items: ActionMenuItem[]
  
  label: string
  
  menuLabel?: string
  
  note?: string
  
  open?: boolean
  onOpenChange?: (open: boolean) => void
  
  appearance?: 'box' | 'plain'
  
  size?: 'row' | 'small'
  
  className?: string
  
  title?: string
  
  triggerProps?: RowMenuTriggerProps
}


export function RowMenuReference({
  items,
  label,
  menuLabel,
  note,
  open: openProp,
  onOpenChange,
  appearance = 'plain',
  size,
  className,
  title,
  triggerProps,
}: ReferenceProps) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }
  const triggerRef = useRef<HTMLButtonElement>(null)
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    
    event.stopPropagation()
    setOpen(!open)
  }
  const common = {
    ...triggerProps,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    onClick: toggle,
  }
  return (
    <>
      {appearance === 'plain' ? (
        <ReferenceMoreAction {...common} label={label} buttonRef={triggerRef} className={className} data-size={size} data-row-menu="" />
      ) : (
        <IconButton {...common} ref={triggerRef} aria-label={label} title={title ?? label} className={className} size={size} variant="plain" data-row-menu="">
          <MoreHorizontal size={size === 'row' ? 14 : 16} aria-hidden="true" />
        </IconButton>
      )}
      <ActionMenu
        open={open}
        ariaLabel={menuLabel ?? label}
        onClose={() => setOpen(false)}
        items={orderActionMenuItems(items)}
        note={note ?? (items.length ? undefined : 'この行に使える操作はありません')}
        anchorRef={triggerRef}
      />
    </>
  )
}

