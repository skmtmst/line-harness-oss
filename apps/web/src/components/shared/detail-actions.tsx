'use client'

import { Children, cloneElement, type ReactElement } from 'react'
import { useStaffRole } from '@/lib/staff-role'
import { lockReason, type PermissionLockKind } from './permission-lock'
import type { ButtonProps } from './button'
import { RowMenu } from './row-actions'
import type { ActionMenuItem } from './action-menu'
import styles from './detail-actions.module.css'
import TruncatedText from './truncated-text'

export type DetailActionsProps = {
  primary?: ReactElement<ButtonProps> | null | false
  secondary?: ReactElement<ButtonProps> | null | false
  permissionNeed?: Exclude<PermissionLockKind, 'viewer'>
  primaryAllowed?: boolean
  secondaryAllowed?: boolean
  menuItems?: (ActionMenuItem & { allowed?: boolean })[]
  menuLabel?: string
}

export function hasDetailActions(actions?: DetailActionsProps): boolean {
  return Boolean(actions && (actions.primary || actions.secondary || actions.menuItems?.length))
}

/** 主・副は各1つ。残りは既存のメニューへ渡し、権限と確認の処理を保つ。 */
export default function DetailActions(props: DetailActionsProps) {
  if (!hasDetailActions(props)) return null
  const blocked = props.primaryAllowed === false || props.secondaryAllowed === false || props.menuItems?.some(item => item.allowed === false)
  return blocked ? <LockedActions {...props} /> : <ActionRow {...props} />
}

/** 理由が必要な場合だけ、画面と同じ本人の控えを購読する。 */
function LockedActions({ primary, secondary, primaryAllowed, secondaryAllowed, permissionNeed = 'feature', menuItems = [], ...rest }: DetailActionsProps) {
  const role = useStaffRole()
  const reason = role === null ? undefined : lockReason(false, permissionNeed)
  const access = (action: DetailActionsProps['primary'], allowed?: boolean) => !action || allowed !== false ? action : cloneElement(action, {
    href: undefined, external: undefined, disabled: true, lockedReason: reason, onClick: undefined,
  } as Partial<ButtonProps>)
  const items = menuItems.map(({ allowed, ...item }) => allowed === false ? { ...item, disabled: true, lockedReason: reason, href: undefined, onSelect: undefined } : item)
  return <ActionRow {...rest} primary={access(primary, primaryAllowed)} secondary={access(secondary, secondaryAllowed)} menuItems={items} />
}

function ActionRow({ primary, secondary, menuItems = [], menuLabel = '詳細のその他操作' }: DetailActionsProps) {
  const compact = (action: DetailActionsProps['primary']) => !action ? action : cloneElement(action, {
    ...(action.props.href === undefined ? { widthReserve: ('widthReserve' in action.props ? action.props.widthReserve : undefined) ?? 'idle' } : {}),
    children: Children.toArray(action.props.children).map((child, index) => typeof child === 'string' || typeof child === 'number' ? <ActionLabel key={index}>{String(child)}</ActionLabel> : child),
  })
  return <div className={styles.actions} data-detail-actions>
    {menuItems.length ? <RowMenu label={menuLabel} items={menuItems} /> : null}
    <div className={styles.main}>{compact(secondary)}{compact(primary)}</div>
  </div>
}

/** Button が文字ありと判断できる口を保ち、長い操作名は全文付きで省略する。 */
function ActionLabel({ children }: { children: string }) {
  return <TruncatedText value={children} />
}
