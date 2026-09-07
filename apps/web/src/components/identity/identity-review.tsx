'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  ApiResponse,
  DecideIdentityCandidateRequest,
  IdentityCandidateDecision,
  IdentityCandidateDetail,
  IdentityCandidateKind,
  IdentityCandidateList,
  IdentityCandidateListItem,
  IdentityReprocessMode,
} from '@line-crm/shared'
import { api, ApiError, type IdentityCandidateWithProfiles } from '@/lib/api'
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
  detail: (IdentityCandidateDetail | IdentityCandidateWithProfiles) | null
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
    profileSelections?: DecideIdentityCandidateRequest['profileSelections']
  }) => void
}

function failureFrom(error: unknown): IdentityFailure {
  if (error instanceof ApiError) return failureOf({ status: error.status, code: error.code })
  return failureOf(null)
}

/** 1回の取得件数。口の上限(100)いっぱいで回す。 */
const IDENTITY_REVIEW_PAGE_SIZE = 100

/**
 * 未判定の候補を全ページ集める。
 *
 * 一覧口にアカウント絞りが無いので、枠外へ落ちる候補が出ないよう
 * 全部取ってから呼び手が絞る。口が offset を無視して同じ頁を返して
 * も、新顔が無くなった時点で止まるので回り続けない。
 */
export async function fetchAllIdentityCandidates(
  fetchPage: (params: {
    kind: IdentityCandidateKind
    status: 'pending'
    limit: number
    offset: number
  }) => Promise<ApiResponse<IdentityCandidateList>>,
  kind: IdentityCandidateKind,
): Promise<IdentityCandidateListItem[]> {
  const collected: IdentityCandidateListItem[] = []
  const seen = new Set<string>()
  let offset = 0
  for (;;) {
    const res = await fetchPage({ kind, status: 'pending', limit: IDENTITY_REVIEW_PAGE_SIZE, offset })
    if (!res.success) throw new Error(res.error || '本人照合の候補を読み込めませんでした')
    let fresh = 0
    for (const item of res.data.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      collected.push(item)
      fresh += 1
    }
    if (res.data.items.length < IDENTITY_REVIEW_PAGE_SIZE || fresh === 0 || collected.length >= res.data.total) break
    offset += IDENTITY_REVIEW_PAGE_SIZE
  }
  return collected
}

export function useIdentityReview(kind: IdentityCandidateKind, options?: { lineAccountId?: string }): IdentityReview {
  const [state, setState] = useState<IdentityViewState>('loading')
  const [items, setItems] = useState<IdentityCandidateListItem[]>([])
  const [failure, setFailure] = useState<IdentityFailure | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detail, setDetail] = useState<IdentityCandidateDetail | IdentityCandidateWithProfiles | null>(null)
  const [decideError, setDecideError] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const lineAccountId = options?.lineAccountId
  useEffect(() => {
    let alive = true
    setState('loading')
    setFailure(null)
    /*
     * 200 でも `success: false` が返ることがある（画面確認のモックも
     * この形で失敗を返す）。中身を読む前に必ず見る。
     */
    const run = async () => {
      try {
        const items = lineAccountId
          /*
           * ECのつき合わせは選んだアカウントだけを出す。一覧口に絞りが
           * 無いので全頁を集めてから手元で絞る。先頭20件だけだと枠外の
           * 候補が「いない」ように見えて対応漏れになる。
           */
          ? (await fetchAllIdentityCandidates(
            (params) => api.identityCandidates.list(params),
            kind,
          )).filter((item) => item.left.lineAccountId === lineAccountId)
          : await api.identityCandidates.list({ kind, status: 'pending', limit: 20, offset: 0 }).then((res) => {
            if (!res.success) throw new Error(res.error)
            return res.data.items
          })
        if (!alive) return
        setItems(items)
        setState(items.length === 0 ? 'empty' : 'ready')
      } catch (error: unknown) {
        if (!alive) return
        if (error instanceof ApiError) {
          const next = failureFrom(error)
          setFailure(next)
          setState(next.kind === 'forbidden' ? 'forbidden' : 'error')
          return
        }
        setFailure(failureOf(null))
        setState('error')
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [kind, lineAccountId, reloadKey])

  // 一覧の1件を開く。詳細は判定に要る `version` と履歴を持っている。
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    setDecideError('')
    const request = kind === 'friend_duplicate'
      ? api.identityCandidates.getFriendDuplicate(selectedId)
      : api.identityCandidates.get(selectedId)
    request
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
  }, [kind, selectedId])

  const decide = useCallback(
    (input: {
      decision: IdentityCandidateDecision
      reason: string
      reprocess?: { mode: IdentityReprocessMode; from: null; to: null }
      profileSelections?: DecideIdentityCandidateRequest['profileSelections']
    }) => {
      if (!detail) return
      setDeciding(true)
      setDecideError('')
      const request = kind === 'friend_duplicate'
        ? api.identityCandidates.decideFriendDuplicate(detail.id, { expectedVersion: detail.version, ...input })
        : api.identityCandidates.decide(detail.id, { expectedVersion: detail.version, ...input })
      request
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
    [detail, kind],
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
