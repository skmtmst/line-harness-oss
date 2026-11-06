'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { createLatestRequestGuard } from './summary-request-guard'

interface Stats {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function useUsersSummary() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [requestGuard] = useState(createLatestRequestGuard)

  const load = useCallback(async () => {
    const requestGeneration = requestGuard.begin()
    setStats(null)
    setStatus('loading')

    try {
      const res = await api.duplicates.stats()
      if (!requestGuard.isCurrent(requestGeneration)) return

      if (!res.success) {
        setStatus('error')
        return
      }

      setStats({
        totalFollowing: res.data.totalFollowing,
        uniquePeople: res.data.uniquePeople,
        friendDups: res.data.friendDups,
      })
      setStatus('ready')
    } catch {
      if (requestGuard.isCurrent(requestGeneration)) setStatus('error')
    }
  }, [requestGuard])

  useEffect(() => {
    void load()
    return () => requestGuard.invalidate()
  }, [load, requestGuard])

  return { stats, status, load }
}
