'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type {
  IdentityCandidateDecision,
  IdentityCandidateDetail,
  IdentityCandidateKind,
  IdentityCandidateListItem,
  IdentityReprocessMode,
} from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import type { IdentityViewState } from './identity-state'
import { failureOf, type IdentityFailure } from './identity-view'

/**
 * 本人照合の2画面（`InCDe` ／ `ELayY`）が共有する読み込み。
 *
 * 出せない状態の描き分けは `identity-state.tsx`。ここは**どの状態にあるか**
 * だけを決める。失敗と権限不足のときは候補を1件も持たせない——名前や
 * マスク済みの値であっても、見てよい人が決まっているものを断片で見せない。
 */
export type IdentityReview = {
  state: IdentityViewState
  items: IdentityCandidateListItem[]
  detail: IdentityCandidateDetail | null
  /** 一覧・詳細が出せないときの言い換え。候補の中身は入らない。 */
  failure: IdentityFailure | null
  /** 判定窓の中だけに出す言い換え（版競合など）。 */
  decideError: string
  deciding: boolean
  /** 詳細を読み込んでいる候補。開いていなければ null。 */
  selectedId: string | null
  /** 判定窓が出ているか。詳細を読むことと、窓を開くことは別。 */
  dialogOpen: boolean
  select: (id: string) => void
  openDialog: (id: string) => void
  closeDialog: () => void
  reload: () => void
  decide: (input: {
    decision: IdentityCandidateDecision
    reason: string
    reprocess?: { mode: IdentityReprocessMode; from: null; to: null }
  }) => void
}

function failureFrom(error: unknown): IdentityFailure {
  if (error instanceof ApiError) return failureOf({ status: error.status, code: error.code })
  return failureOf(null)
}

export function useIdentityReview(kind: IdentityCandidateKind): IdentityReview {
  const [state, setState] = useState<IdentityViewState>('loading')
  const [items, setItems] = useState<IdentityCandidateListItem[]>([])
  const [failure, setFailure] = useState<IdentityFailure | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detail, setDetail] = useState<IdentityCandidateDetail | null>(null)
  const [decideError, setDecideError] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    setFailure(null)
    api.identityCandidates
      .list({ kind, status: 'pending', limit: 20, offset: 0 })
      .then((res) => {
        if (!alive) return
        /*
         * 200 でも `success: false` が返ることがある（画面確認のモックも
         * この形で失敗を返す）。中身を読む前に必ず見る。
         */
        if (!res.success) {
          setFailure(failureOf(null))
          setState('error')
          return
        }
        setItems(res.data.items)
        setState(res.data.items.length === 0 ? 'empty' : 'ready')
      })
      .catch((error: unknown) => {
        if (!alive) return
        const next = failureFrom(error)
        setFailure(next)
        setState(next.kind === 'forbidden' ? 'forbidden' : 'error')
      })
    return () => {
      alive = false
    }
  }, [kind, reloadKey])

  // 一覧の1件を開く。詳細は判定に要る `version` と履歴を持っている。
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    setDecideError('')
    api.identityCandidates
      .get(selectedId)
      .then((res) => {
        if (!alive) return
        if (!res.success) {
          setDecideError(failureOf(null).title)
          return
        }
        setDetail(res.data)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setDecideError(failureFrom(error).title)
      })
    return () => {
      alive = false
    }
  }, [selectedId])

  const decide = useCallback(
    (input: {
      decision: IdentityCandidateDecision
      reason: string
      reprocess?: { mode: IdentityReprocessMode; from: null; to: null }
    }) => {
      if (!detail) return
      setDeciding(true)
      setDecideError('')
      api.identityCandidates
        .decide(detail.id, { expectedVersion: detail.version, ...input })
        .then((res) => {
          if (!res.success) {
            setDecideError(failureOf(null).description)
            return
          }
          setDialogOpen(false)
          setSelectedId(null)
          setReloadKey((key) => key + 1)
        })
        .catch((error: unknown) => {
          const next = failureFrom(error)
          setDecideError(`${next.title}。${next.description}`)
        })
        .finally(() => setDeciding(false))
    },
    [detail],
  )

  return {
    state,
    items,
    detail,
    failure,
    decideError,
    deciding,
    selectedId,
    dialogOpen,
    select: setSelectedId,
    openDialog: (id: string) => {
      setSelectedId(id)
      setDecideError('')
      setDialogOpen(true)
    },
    closeDialog: () => setDialogOpen(false),
    reload: () => setReloadKey((key) => key + 1),
    decide,
  }
}
