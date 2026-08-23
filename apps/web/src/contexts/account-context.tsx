'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'

const STORAGE_KEY = 'lh_selected_account'

export interface AccountWithStats {
  id: string
  channelId: string
  name: string
  displayName?: string
  pictureUrl?: string | null
  basicId?: string | null
  isActive: boolean
  country: string | null
  role: string | null
  displayOrder: number
  liffId?: string | null
  webhook?: {
    expectedUrl: string
    actualUrl: string | null
    active: boolean | null
    status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown'
  }
  plan?: {
    key: 'communication' | 'light' | 'standard' | 'unknown'
    label: string
    monthlyMessageLimit: number | null
    source: 'messaging-api-quota'
  }
  stats?: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

interface AccountContextValue {
  accounts: AccountWithStats[]
  selectedAccountId: string | null
  selectedAccount: AccountWithStats | null
  setSelectedAccountId: (id: string) => void
  clearSelectedAccountId: () => void
  refreshAccounts: () => Promise<void>
  loading: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const setSelectedAccountId = useCallback((id: string) => {
    setSelectedAccountIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const clearSelectedAccountId = useCallback(() => {
    setSelectedAccountIdState(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await api.lineAccounts.list(false)
      if (res.success && res.data.length > 0) {
        const list = res.data as AccountWithStats[]
        setAccounts(list)

        // 無効になった選択だけを解除する。未選択のときに先頭へ勝手に
        // フォールバックすると、統括の着地点を店舗数で決められない。
        setSelectedAccountIdState((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev
          // 保存値が有効なら復元する。保存値も無ければ未選択のままにする。
          let stored: string | null = null
          try {
            stored = localStorage.getItem(STORAGE_KEY)
          } catch {
            // localStorage unavailable
          }
          const valid = stored && list.some((a) => a.id === stored)
          return valid ? stored : null
        })
      } else {
        setAccounts([])
        setSelectedAccountIdState(null)
      }
    } catch {
      // Failed to load accounts
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <AccountContext.Provider
      value={{ accounts, selectedAccountId, selectedAccount, setSelectedAccountId, clearSelectedAccountId, refreshAccounts, loading }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
