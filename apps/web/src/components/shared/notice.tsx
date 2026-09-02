'use client'

import React, { useEffect, type HTMLAttributes } from 'react'
import { CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react'
import styles from './notice.module.css'

export type NoticeTone = 'success' | 'validation' | 'error'

export type NoticeProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: NoticeTone
  message: string
  duration?: number
  onClose?: () => void
}

const NODE_BY_TONE: Record<NoticeTone, string> = {
  success: 'ApbSZ',
  validation: 'zPRvi',
  error: 'I5rKbM',
}

/** Pencil V5の成功・入力確認・失敗を同じAPIで表示する共通通知。 */
export default function Notice({ tone, message, duration, onClose, className, ...props }: NoticeProps) {
  useEffect(() => {
    if (!duration || !onClose) return
    const timer = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(timer)
  }, [duration, onClose])

  const Icon = tone === 'success' ? CircleCheck : tone === 'validation' ? TriangleAlert : CircleX
  return (
    <div
      {...props}
      className={[styles.notice, styles[tone], className].filter(Boolean).join(' ')}
      role={tone === 'success' ? 'status' : 'alert'}
      data-design-part="notice"
      data-design-node={NODE_BY_TONE[tone]}
    >
      <Icon className={styles.icon} aria-hidden="true" size={18} />
      <span className={styles.message}>{message}</span>
      {onClose ? <button type="button" className={styles.close} onClick={onClose} aria-label="通知を閉じる"><X aria-hidden="true" size={16} /></button> : null}
    </div>
  )
}
