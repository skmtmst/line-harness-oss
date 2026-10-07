'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'

/**
 * いまの運営メンバーが閲覧のみか（/api/ops/me の readOnly）。
 * 分かるまでは閲覧のみとして扱い、押せないボタンを先に出さない（2026-10-06 オーナー決定）。
 * 取れなかったときも閲覧のみのまま（変える操作は出さない）。
 */
export function useOpsReadOnly(): boolean {
  const [readOnly, setReadOnly] = useState(true)
  useEffect(() => {
    let active = true
    let call: ReturnType<typeof api.ops.me> | null = null
    try {
      call = api.ops.me()
    } catch {
      call = null
    }
    if (!call) return () => { active = false }
    void opsCall(call).then((res) => { if (active && res.success) setReadOnly(res.data.readOnly) })
    return () => { active = false }
  }, [])
  return readOnly
}
