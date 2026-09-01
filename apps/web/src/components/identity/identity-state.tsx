import React from 'react'
import ListState from '@/components/shared/list-state'
import type { IdentityFailure } from './identity-view'

/**
 * 本人照合の2画面（`InCDe` ／ `ELayY`）が共有する「中身を出せないとき」。
 *
 * 分けるのは5つ。**読込・通常・空・失敗・権限不足**。
 * 空と失敗を同じ「ありません」にすると、読めていないだけなのに
 * 「候補が消えた」に見える。権限不足も「失敗」に混ぜない——直し方が違う。
 *
 * 読み口（`@/lib/api`）を持ち込まない。持ち込むと、この判断だけを
 * 確かめたい試験まで API の設定を要求されて、確かめる先が増える。
 */
export type IdentityViewState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden'

/**
 * 中身を出せないときの1枚。共通の `ListState` に、この画面の文言だけを渡す。
 *
 * `ready` のときは何も描かない（呼び手が中身を描く）。
 */
export function IdentityStateBlock({
  state,
  failure,
  emptyTitle,
  emptyDescription,
}: {
  state: IdentityViewState
  failure: IdentityFailure | null
  emptyTitle: string
  emptyDescription: string
}) {
  if (state === 'ready') return null
  if (state === 'loading') return <ListState kind="loading" />
  if (state === 'empty') {
    return <ListState kind="empty" title={emptyTitle} description={emptyDescription} />
  }
  const kind = state === 'forbidden' ? 'forbidden' : 'error'
  return <ListState kind={kind} title={failure?.title} description={failure?.description} />
}
