'use client'

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode, type MouseEvent } from 'react'
import Button, { type ButtonProps } from '@/components/shared/button'
import { RowMenu, type RowMenuProps } from '@/components/shared/row-actions'
import { headingActionNodes, actionLabel } from './page-action-nodes'
import type { ActionMenuItem } from '@/components/shared/action-menu'

/** 題の右は副操作1つ（文字）・主操作1つ・その他のメニュー。操作と無効条件は元のボタンを保つ。 */
export default function PageHeadingActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const nodes = headingActionNodes(children)
  const buttons = nodes.filter((node): node is ReactElement<ButtonProps> => isValidElement(node) && node.type === Button)
  const primary = buttons.find(node => node.props.variant === 'primary')
  const secondary = buttons.find(node => node !== primary && node.props.variant !== 'primary')
  const menus = nodes.filter((node): node is ReactElement<RowMenuProps> => isValidElement(node) && node.type === RowMenu)
  const extras = buttons.filter(node => node !== primary && node !== secondary)
  const items: ActionMenuItem[] = extras.map((node, index) => ({
    id: `heading-${index}`, label: actionLabel(node.props.children),
    content: cloneElement(node, {
      variant: 'text', role: 'menuitem',
      onClick: (event: MouseEvent<HTMLButtonElement> & MouseEvent<HTMLAnchorElement>) => {
        // Return focus before opening another surface, as ActionMenu does for normal items.
        document.querySelector<HTMLElement>('[data-page-heading-actions] [aria-haspopup="menu"]')?.focus()
        node.props.onClick?.(event)
        if (!event.defaultPrevented) setOpen(false)
      },
    }),
  }))
  items.push(...menus.flatMap(menu => menu.props.items))
  const other = nodes.filter(node => !buttons.includes(node as ReactElement<ButtonProps>) && !menus.includes(node as ReactElement<RowMenuProps>))
  return <span data-page-heading-actions>
    {other}
    {secondary ? cloneElement(secondary, { variant: 'text' }) : null}
    {primary}
    {extras.length ? <RowMenu label="その他の操作" items={items} open={open} onOpenChange={setOpen} /> : menus}
  </span>
}
