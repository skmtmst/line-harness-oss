'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import { HANDOVER_STEPS, MATCH_BUCKETS } from './handover-view'

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
        <ol className="mt-3 space-y-2">
          {HANDOVER_STEPS.map((step) => (
            <li key={step.order} className="border-hairline rounded-control flex items-center gap-3 border p-3">
              <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{step.order}</span>
              <span className="text-ink text-xs">{step.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
        <p className="text-ink text-sm font-bold">事前確認で分かること</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          事前確認をすると、元の友だちが次の4つに分かれます。
          本実行はしていません。ここで止めても、元のアカウントは何も変わりません。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {MATCH_BUCKETS.map((bucket) => (
            <div key={bucket.key} className="border-hairline rounded-card border p-4">
              <p className="text-ink-faint text-xs">{bucket.label}</p>
              {/*
                **人数を作らない。** 事前確認の口がまだ無い（台帳 #133）。
                0 と書くと「1人もいない」と読まれる。
              */}
              <p className="text-ink mt-1 text-2xl font-semibold">—</p>
              <p className="text-ink-faint mt-1 text-xs">{bucket.note}</p>
            </div>
          ))}
        </div>
        <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
          「要確認」を全部決めるまで本実行できません。決めた内容はあとから見返せます。
        </p>
      </section>

      {/*
        **できない口を置かない。** 引き継ぎコードを出す仕組みが無いので、
        押し口ではなく理由を書く（`docs/v6-common-rules.md` §7-10）。
      */}
      <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
        <p className="text-ink text-sm font-bold">まだ始められません</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          引き継ぎコードを出す仕組みと、事前確認の突合が、まだ繋がっていません。
          接続されると、この画面から乗り換えを始められます。
        </p>
        <Button href={`/accounts/detail?id=${account.id}`} className="mt-3">
          アカウントの詳細へ戻る
        </Button>
      </section>
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
