'use client'

import { cloneElement, useState, type ReactElement, type MouseEvent } from 'react'
import type { ButtonProps } from '@/components/shared/button'
import { RowMenu } from '@/components/shared/row-actions'
import { actionLabel } from './page-action-nodes'

export default function FormSecondaryActions({ buttons }: { buttons: ReactElement<ButtonProps>[] }) {
  const [open, setOpen] = useState(false)
  return <RowMenu label="作成・編集のその他の操作" open={open} onOpenChange={setOpen} items={buttons.map((node, index) => ({
    id: `form-${index}`, label: actionLabel(node.props.children),
    content: cloneElement(node, { variant: 'text', role: 'menuitem', onClick: (event: MouseEvent<HTMLButtonElement> & MouseEvent<HTMLAnchorElement>) => {
      document.querySelector<HTMLElement>('[aria-label="作成・編集のその他の操作"]')?.focus()
      node.props.onClick?.(event)
      if (!event.defaultPrevented) setOpen(false)
    } }),
  }))} />
}
