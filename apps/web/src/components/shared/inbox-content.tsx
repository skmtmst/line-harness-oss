'use client'

import type { HTMLAttributes, ImgHTMLAttributes, Ref } from 'react'
import { motionMs, useV8Leave } from './overlay-utils'
import styles from './inbox-content.module.css'

/** 会話の媒体・補助面。取得、再読込、保存、開閉は呼び出す画面が持つ。 */
export function InboxMedia({ kind, alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { kind: 'sticker' | 'image' | 'preview'; alt: string }) {
  return <img {...props} alt={alt} className={styles.media} data-kind={kind} />
}
export function InboxFlexContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={styles.flexMedia} />
}
export function InboxFloatingPanel({ placement, open = true, ...props }: HTMLAttributes<HTMLDivElement> & { open?: boolean; placement: 'above' | 'below'; ref?: Ref<HTMLDivElement> }) {
  const leaving = useV8Leave(open, motionMs('--motion-instant', 80))
  if (!open && !leaving) return null
  return <div {...props} className={styles.floating} data-placement={placement} data-leaving={leaving || undefined} inert={!open} aria-hidden={!open || undefined} />
}
export function InboxInfoBackdrop({ wide, ...props }: HTMLAttributes<HTMLDivElement> & { wide: boolean }) {
  return wide ? null : <div {...props} aria-hidden="true" className={styles.backdrop} />
}
export function InboxEmailHeading(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={styles.emailHeading} />
}
