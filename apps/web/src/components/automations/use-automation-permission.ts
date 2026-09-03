'use client'

import { useEffect, useState } from 'react'

/** Workerの owner/admin 制約と同じ条件で、下書き操作の表示を切り替える。 */
export function useCanManageAutomations(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    const role = window.localStorage.getItem('lh_staff_role')
    setAllowed(role === 'owner' || role === 'admin')
  }, [])
  return allowed
}
