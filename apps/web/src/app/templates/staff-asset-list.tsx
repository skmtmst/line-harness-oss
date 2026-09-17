'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastAssetKind, type BroadcastMessageAsset } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const LABELS: Record<BroadcastAssetKind, { title: string; singular: string }> = {
  rich_message: { title: 'リッチメッセージ', singular: 'リッチメッセージ' },
  card_message: { title: 'カルーセル', singular: 'カルーセル' },
  coupon: { title: 'クーポン', singular: 'クーポン' },
  research: { title: 'リサーチ', singular: 'リサーチ' },
}

/*
 * N-144: staff 向けの資産一覧。作成・変更・削除APIは owner/admin 限定なので、
 * 変更系の操作を持つ BroadcastAssetManager は出さず、こちらは閲覧だけに絞る。
 * 「一斉配信で使う」は画面遷移であり変更操作ではないため残す。
 */
export default function StaffAssetList({ kind }: { kind: BroadcastAssetKind }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BroadcastMessageAsset[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.broadcastMessageAssets.list({ accountId: selectedAccountId || undefined, kind })
      if (res.success) setItems(res.data)
    } finally {
      setLoading(false)
    }
  }, [kind, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const meta = LABELS[kind]

  if (loading) {
    return <p className="text-ink-faint py-8 text-center text-sm">読み込み中...</p>
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <article key={item.id} className="bg-canvas rounded-card border-hairline border p-5">
          <span className="bg-accent-soft text-accent-deep rounded-pill px-2 py-1 text-xs font-bold">{meta.title}</span>
          <h3 className="text-ink mt-3 truncate font-bold">{item.name}</h3>
          <p className="text-ink-faint mt-1 text-xs">更新 {new Date(item.updatedAt).toLocaleString('ja-JP')}</p>
          <div className="mt-4">
            <a href={`/broadcasts/new?contentTemplateId=${encodeURIComponent(item.id)}`} className="border-accent text-accent rounded-control inline-block border px-3 py-2 text-sm font-bold">一斉配信で使う</a>
          </div>
        </article>
      ))}
      {items.length === 0 && (
        <div className="bg-canvas border-hairline text-ink-faint col-span-full rounded-card border border-dashed p-12 text-center text-sm">
          まだ{meta.singular}テンプレートがありません。
        </div>
      )}
    </div>
  )
}
