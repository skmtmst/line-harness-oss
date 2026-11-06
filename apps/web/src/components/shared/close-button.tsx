import React, { type ComponentProps } from 'react'
import { X } from 'lucide-react'
import IconButton from './icon-button'

/** 閉じる・外すの「×」。文字の「×」「✕」ではなく、SVG の印で描く共通のボタン。 */
export default function CloseButton({
  'aria-label': ariaLabel = '閉じる',
  size = 'small',
  variant = 'plain',
  ...props
}: Omit<ComponentProps<typeof IconButton>, 'children' | 'aria-label'> & { 'aria-label'?: string }) {
  return (
    <IconButton aria-label={ariaLabel} size={size} variant={variant} {...props}>
      <X aria-hidden="true" />
    </IconButton>
  )
}
