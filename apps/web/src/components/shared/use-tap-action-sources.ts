'use client'

/*
 * 「押したら」の中身で選ぶ、作ってあるもの（回答フォーム・予約メニュー・スタンプカード）を店のアカウントから読む。
 * 読めなかった種類は undefined のまま（窓に「読み込めませんでした」）。統括・アカウント未選択では読まない。
 */
import { useEffect, useState } from 'react'
import { api, bookingApi } from '@/lib/api'
import { visitStampsApi } from '@/lib/visit-stamps-api'
import * as accountContext from '@/contexts/account-context'
import type { TapActionSources } from './tap-action-field'

export function useTapActionSources(accountId: string | null | undefined, want: { form?: boolean; booking?: boolean; visit_stamp?: boolean } = { form: true, booking: true, visit_stamp: true }): TapActionSources {
  const [sources, setSources] = useState<TapActionSources>({})
  const { form = false, booking = false, visit_stamp: stamp = false } = want
  useEffect(() => {
    setSources({})
    if (!accountId) return
    let cancelled = false
    const put = (patch: TapActionSources) => { if (!cancelled) setSources((current) => ({ ...current, ...patch })) }
    if (form) {
      void Promise.resolve().then(() => api.forms.list(accountId)).then((res) => {
        if (res.success) put({ form: res.data.map((item) => ({ id: item.id, name: item.name, note: item.isActive ? undefined : '受け付けを止めています', disabled: !item.isActive })) })
      }).catch(() => {})
    }
    if (booking) {
      void Promise.resolve().then(() => bookingApi.listMenus(accountId)).then((res) => {
        put({ booking: (res.menus ?? []).filter((menu) => menu.is_active).map((menu) => ({ id: menu.id, name: menu.name, note: menu.category_label ?? undefined })) })
      }).catch(() => {})
    }
    if (stamp) {
      void Promise.resolve().then(() => visitStampsApi.cards()).then((res) => {
        put({ visit_stamp: res.data.filter((card) => card.active && (card.accountIds.length === 0 || card.accountIds.includes(accountId))).map((card) => ({ id: card.id, name: card.name })) })
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [accountId, form, booking, stamp])
  return sources
}

type TapAccount = NonNullable<ReturnType<typeof accountContext.useOptionalAccount>>

/*
 * 上のバーのアカウント（LIFF の有無を読む）。AccountProvider の外（部品だけの試験）では null。
 * 試験のモックが useOptionalAccount を持たないと読んだ時点で投げるので、そのときも null（呼ぶ hook の数は毎回同じ）。
 */
export function useTapActionAccount(): TapAccount | null {
  let hook: typeof accountContext.useOptionalAccount | undefined
  try { hook = accountContext.useOptionalAccount } catch { hook = undefined }
  return hook ? hook() : null
}

/** アカウントの LIFF ID（無ければ null）。accountId を省くと上のバーで選んでいるアカウント。 */
export function tapLiffIdOf(account: TapAccount | null, accountId?: string | null): string | null {
  if (!account) return null
  const id = accountId === undefined ? account.selectedAccountId : accountId
  const found = (account.accounts ?? []).find((item) => item.id === id)
  if (found) return found.liffId || null
  return id && id === account.selectedAccountId ? account.selectedAccount?.liffId || null : null
}
