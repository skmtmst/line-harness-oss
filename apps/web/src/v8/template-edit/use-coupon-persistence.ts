'use client'

import { useRef } from 'react'
import { api, type BroadcastMessageAsset } from '@/lib/api'
import type { BroadcastAssetKind } from '@/lib/api/types/broadcasts'

export class AssetPublishError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : '公開を確認できませんでした', { cause })
  }
}

/** Keep the saved draft and the publish key when the outcome of publication is unknown. */
export function useCouponPersistence(accountId: string | null, existing?: BroadcastMessageAsset, kind: BroadcastAssetKind = 'coupon') {
  const scope = useRef({ accountId, kind })
  const saved = useRef<{ accountId: string; asset: BroadcastMessageAsset; snapshot: string } | null>(null)
  const publish = useRef<{ id: string; revision: number; version: number; key: string } | null>(null)
  const pending = useRef<{ scope: object; snapshot: string; shouldPublish: boolean; promise: Promise<string> } | null>(null)
  if (scope.current.accountId !== accountId || scope.current.kind !== kind) {
    scope.current = { accountId, kind }
    saved.current = null
    publish.current = null
  }
  const persist = async (name: string, payload: Record<string, unknown>, folderId: string | null, snapshot: string, shouldPublish: boolean) => {
    const account = accountId
    const requestScope = scope.current
    if (!account) throw new Error('LINE公式アカウントを選んでください')
    const previous = saved.current?.accountId === account ? saved.current : null
    let asset = previous?.asset ?? existing
    if (!previous || previous.snapshot !== snapshot) {
      const response = asset
        ? await api.broadcastMessageAssets.update(asset.id, { name, payload, ...(kind === 'coupon' ? { folderId } : {}) })
        : await api.broadcastMessageAssets.create({ lineAccountId: account, kind, name, payload, folderId })
      if (!response.success) throw new Error(response.error || 'テンプレートを保存できませんでした')
      if (scope.current !== requestScope) throw new Error('LINE公式アカウントが変わりました。保存先の一覧を確認してください')
      asset = response.data
      saved.current = { accountId: account, asset, snapshot }
      publish.current = null
    }
    if (!asset) throw new Error('保存したテンプレートを確認できませんでした')
    if (scope.current !== requestScope) throw new Error('LINE公式アカウントが変わりました。公開していません')
    if (!shouldPublish) return asset.id
    const version = asset.publishedVersion, revision = asset.draftRevision
    if (version === undefined || revision === undefined || !Number.isInteger(version) || !Number.isInteger(revision)) {
      throw new Error('版の番号を確認できませんでした。テンプレートを読み直してください')
    }
    if (!publish.current || publish.current.id !== asset.id || publish.current.revision !== revision || publish.current.version !== version) {
      publish.current = { id: asset.id, version, revision, key: crypto.randomUUID() }
    }
    let response: Awaited<ReturnType<typeof api.broadcastMessageAssets.publish>>
    try {
      response = await api.broadcastMessageAssets.publish(asset.id, { expectedVersion: version, expectedDraftRevision: revision }, publish.current.key)
    } catch (error) { throw new AssetPublishError(error) }
    if (!response.success) throw new AssetPublishError(new Error(response.error || '公開できませんでした。下書きは残っています'))
    if (scope.current !== requestScope) throw new Error('LINE公式アカウントが変わりました。保存先の一覧を確認してください')
    saved.current = { accountId: account, asset: response.data, snapshot }
    return asset.id
  }
  return (...args: Parameters<typeof persist>): Promise<string> => {
    const current = pending.current
    if (current) {
      if (current.scope === scope.current && current.snapshot === args[3] && current.shouldPublish === args[4]) return current.promise
      return Promise.reject(new Error('保存中です。完了してから、もう一度操作してください'))
    }
    const promise = (async () => {
      try { return await persist(...args) }
      finally { pending.current = null }
    })()
    pending.current = { scope: scope.current, snapshot: args[3], shouldPublish: args[4], promise }
    return promise
  }

}
