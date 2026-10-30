'use client'

import { useRef } from 'react'

export type ContentChangeAccess = {
  disabled?: boolean
  lockedReason?: string
  /** 呼び出し側が本人・対象・代理モードの切替による失効を記憶する。 */
  canChangeNow?: () => boolean
}

/** 描画時と現在の両方を操作時に確かめる。未指定の読み取りと操作は変えない。 */
export function useContentChangeAccess(access: ContentChangeAccess) {
  const provided = access.disabled !== undefined || access.lockedReason !== undefined || access.canChangeNow !== undefined
  const captured = { ...access, provided }
  const latest = useRef(captured)
  latest.current = captured
  const permits = (policy: typeof captured) => !policy.provided || (!policy.disabled && !policy.lockedReason && policy.canChangeNow?.() !== false)
  const blocked = provided && (Boolean(access.disabled || access.lockedReason) || access.canChangeNow?.() === false)
  return { provided, blocked, disabled: blocked && !access.lockedReason, lockedReason: access.lockedReason,
    canChangeNow: () => permits(captured) && permits(latest.current) }
}
