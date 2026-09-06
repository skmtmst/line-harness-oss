'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import { DIFFERENT_PROVIDER_NOTE, HANDOVER_STEPS, MATCH_BUCKETS } from './handover-view'

/**
 * LINEアカウントの乗り換え・引き継ぎ。設計 ★V6 33-4（`nx3XW`）。
 *
 * **口がまだ無い**（台帳 #133）。5 段の流れと、事前確認で何が出るかを
 * 描いたうえで、「まだ繋がっていません」と止める。**人数は作らない。**
 *
 * 流れを描くのは、運用者が「何が起きるか」を先に読めるようにするため。
 * 白紙にすると、何を待っているのかも分からない。
 */
function Handover() {
  const search = useSearchParams()
  const id = search?.get('id') ?? ''
  const [account, setAccount] = useState<LineAccount | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    try {
      const res = await api.lineAccounts.get(id)
      if (!res.success) { setStatus('error'); return }
      setAccount(res.data)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !account) {
    return (
      <ListState
        kind="error"
        action={<Button type="button" onClick={() => void load()}>再読み込み</Button>}
      />
    )
  }

  return (
    <div data-design-node="nx3XW">
      <PageHeader
        breadcrumb={[
          { label: 'LINEアカウント', href: '/accounts' },
          { label: account.name, href: `/accounts/detail?id=${account.id}` },
          { label: '乗り換え' },
        ]}
        title="乗り換え・引き継ぎ"
        description="別のLINEアカウントへ、友だちと設定を引き継ぎます。事前確認をしてから本実行します。"
      />

      <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
        <p className="text-ink text-sm font-bold">進みかた</p>
        <ol className="mt-4 grid gap-2 lg:grid-cols-5">
          {HANDOVER_STEPS.map((step) => (
            <li key={step.order} className="border-hairline rounded-control flex items-center gap-3 border p-3">
              <span className="bg-action-soft text-action flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                {step.order}
              </span>
              <span className="text-ink text-xs font-medium leading-relaxed">{step.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">乗り換え元と受け取り先</p>
            <div className="mt-4 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="bg-canvas-sunken rounded-control p-4">
                <p className="text-ink-faint text-xs">乗り換え元</p>
                <p className="text-ink mt-1 text-sm font-bold">{account.name}</p>
                <p className="text-ink-faint mt-1 text-xs">チャネル {account.channelId}</p>
              </div>
              <span className="text-ink-faint text-center text-lg" aria-hidden>→</span>
              <div className="border-hairline rounded-control border border-dashed p-4">
                <p className="text-ink-faint text-xs">受け取り先</p>
                <p className="text-ink mt-1 text-sm font-bold">まだ選ばれていません</p>
                <p className="text-ink-faint mt-1 text-xs">引き継ぎコードを読むと表示します</p>
              </div>
            </div>
            <p className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-relaxed">
              {DIFFERENT_PROVIDER_NOTE}
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">事前確認の結果</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              事前確認をすると、元の友だちが次の4つに分かれます。
              本実行はしていません。ここで止めても、元のアカウントは何も変わりません。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {MATCH_BUCKETS.map((bucket) => (
                <div key={bucket.key} className="border-hairline rounded-card border p-4">
                  <p className="text-ink-faint text-xs">{bucket.label}</p>
                  {/* **固定データが無いので人数を作らない。** */}
                  <p className="text-ink mt-1 text-2xl font-semibold">—</p>
                  <p className="text-ink-faint mt-1 text-xs">{bucket.note}</p>
                </div>
              ))}
            </div>
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              「要確認」を全部決めるまで本実行できません。決めた内容はあとから見返せます。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline border-b px-5 py-4">
              <p className="text-ink text-sm font-bold">要確認の友だち</p>
              <p className="text-ink-secondary mt-1 text-xs">候補を見比べて、引き継ぐ・新しく作る・除外するを決めます。</p>
            </div>
            <div className="px-5 py-8 text-center">
              <p className="text-ink text-sm font-medium">事前確認の結果はまだありません</p>
              <p className="text-ink-faint mt-1 text-xs">引き継ぎコードと突合データが届くと、ここに候補を表示します。</p>
            </div>
          </section>

          <div className="flex flex-wrap justify-between gap-2">
            <Button href={`/accounts/detail?id=${account.id}`}>アカウントの詳細へ戻る</Button>
            <Button type="button" variant="primary" disabled>本実行へ進む</Button>
          </div>
        </div>

        <aside className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">引き継ぎコード</p>
            <div className="bg-canvas-sunken rounded-control mt-3 p-4 text-center">
              <p className="text-ink text-xl font-bold tracking-[0.2em]">— — — — — —</p>
              <p className="text-ink-faint mt-2 text-xs">コードはまだ発行されていません</p>
            </div>
          </section>

          {/* 動かない理由は、押し口ではなく本文で伝える。 */}
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">まだ始められません</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              引き継ぎコードを出す仕組みと、事前確認の突合が、まだ繋がっていません。
              接続されると、この画面から乗り換えを始められます。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">安全のために</p>
            <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
              <li>・事前確認だけでは元データを変えません。</li>
              <li>・件数の合計が一致しなければ実行しません。</li>
              <li>・実行後も照合結果と切り戻しの記録を残します。</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default function HandoverPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <Handover />
    </Suspense>
  )
}
