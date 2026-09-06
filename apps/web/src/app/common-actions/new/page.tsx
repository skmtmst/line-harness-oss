'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  ApiError,
  type CommonActionResources,
  type CommonActionStep,
} from '@/lib/api'
import CommonActionEditor, { newCommonActionStep } from '@/components/automations/common-action-editor'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { TextField } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'

const EMPTY_RESOURCES: CommonActionResources = {
  tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [],
}
export default function NewCommonActionPage() {
  usePageTitle('共通アクションをつくる')
  const canManage = useCanManageCommonActions()
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [actions, setActions] = useState<CommonActionStep[]>([newCommonActionStep()])
  const [resources, setResources] = useState<CommonActionResources>(EMPTY_RESOURCES)
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accountLoading || canManage !== true || !selectedAccountId) {
      if (!accountLoading) setResourcesLoading(false)
      return
    }
    let cancelled = false
    setResourcesLoading(true)
    api.commonActions.resources(selectedAccountId)
      .then((response) => {
        if (!cancelled && response.success) setResources(response.data)
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '選択肢を読み込めませんでした')
      })
      .finally(() => {
        if (!cancelled) setResourcesLoading(false)
      })
    return () => { cancelled = true }
  }, [accountLoading, canManage, selectedAccountId])

  const save = async () => {
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('共通アクション名を入力してください')
      return
    }
    if (actions.length === 0) {
      setError('処理を1つ以上追加してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await api.commonActions.create(selectedAccountId, {
        name: name.trim(),
        description: description.trim() || null,
        actions,
      })
      if (!response.success) throw new Error(response.error)
      router.push(`/common-actions/versions?id=${encodeURIComponent(response.data.id)}`)
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : '下書きを保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (canManage === null) return <div className="text-ink-faint p-6 text-sm">権限を確認しています</div>
  if (!canManage) return (
    <div className="border-hairline rounded-card border bg-canvas p-6">
      {/*
        **画面名はトップバーが出すので、ここで `<h1>` を作らない。**
        権限不足は「この画面が何か」ではなく「いまどの状態か」なので、
        見出しの階層を1つ下げて `<h2>` にする。
      */}
      <h2 className="text-ink text-lg font-semibold">共通アクションは閲覧のみです</h2>
      <p className="text-ink-secondary mt-2 text-sm">作成するには、オーナーまたは管理者の権限が必要です。</p>
      <Button href="/common-actions" className="mt-4">共通アクション一覧へ戻る</Button>
    </div>
  )

  return (
    <div data-design-node="py5CG" className="pb-24">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-ink-faint">オートメーション ＞ 共通アクション ＞ つくる</p>
        <div className="text-right">
          <button type="button" disabled className="h-10 rounded-control border border-hairline bg-canvas px-4 text-sm font-semibold text-ink-faint">1人で試す</button>
          <p className="mt-1 text-[11px] text-ink-faint">テスト実行は未接続</p>
        </div>
      </div>

      <div className="common-action-editor-grid grid items-start gap-4">
        <div className="space-y-4">
          <section className="border-hairline rounded-card border bg-canvas p-5">
            <h2 className="text-ink font-semibold">どんなアクションか</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="text-ink-secondary block text-sm">
                アクション名
                <TextField value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1" placeholder="例：来店後のお礼を送る" />
              </label>
              <label className="text-ink-secondary block text-sm">
                ひとこと説明
                <TextField value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} className="mt-1" placeholder="使う場面や目的を書きます" />
              </label>
            </div>
          </section>

          <section className="border-hairline rounded-card border bg-canvas p-5">
            <div className="mb-3">
              <h2 className="text-ink font-semibold">処理を上から順に並べる</h2>
              <p className="text-ink-faint mt-1 text-sm">上の行から順に実行します。途中で失敗したときの動きも、行ごとに決められます。公開後の版は書き換わりません。</p>
            </div>
            {resourcesLoading ? (
              <div className="border-hairline rounded-card border bg-canvas p-8 text-center text-sm text-ink-faint">選択肢を読み込んでいます</div>
            ) : (
              <div className="compact-common-action-editor"><CommonActionEditor value={actions} resources={resources} onChange={setActions} /></div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled title="条件分岐の保存・実行は未接続です">条件で分ける</Button>
              <Button onClick={() => setActions((current) => [...current, newCommonActionStep('wait')])}>待ち時間を入れる</Button>
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="border-hairline rounded-card border bg-canvas p-5">
            <h2 className="text-ink font-semibold">版のこと</h2>
            <ul className="text-ink-secondary mt-3 space-y-3 text-sm leading-6">
              <li><strong className="text-ink">公開しても、いまの利用先は変わりません</strong><br />すでに呼び出している場所はいまの版のまま動きます。使う場所ごとに新しい版へ更新したときだけ切り替わります。</li>
              <li><strong className="text-ink">動き始めたものは、その版のまま終わります</strong><br />途中で公開しても、いま動いているものには効きません。</li>
              <li><strong className="text-ink">前の版から、新しい版を作れます</strong><br />公開済みの版と過去の実行記録は書き換わりません。</li>
            </ul>
            <ol className="text-ink-faint mt-4 space-y-1 border-t border-hairline pt-3 text-xs">
              <li>1. ここでは下書きとして保存します</li>
              <li>2. 内容を確認して版を公開します</li>
              <li>3. 利用先ごとに使う版を選びます</li>
            </ol>
          </section>
          <section className="border-hairline rounded-card border bg-canvas p-5">
            <h2 className="text-ink font-semibold">つながる先</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href="/automations" className="font-semibold text-info">オートメーション</a><span className="float-right text-ink-faint">きっかけを決めて呼ぶ</span></li>
              <li><a href="/scenarios" className="font-semibold text-info">シナリオ配信</a><span className="float-right text-ink-faint">送信後に呼ぶ</span></li>
              <li><a href="/forms" className="font-semibold text-info">回答フォーム</a><span className="float-right text-ink-faint">送信後に呼ぶ</span></li>
              <li><a href="/auto-replies" className="font-semibold text-info">自動応答</a><span className="float-right text-ink-faint">返信後に呼ぶ</span></li>
              <li><a href="/rich-menus" className="font-semibold text-info">リッチメニュー</a><span className="float-right text-ink-faint">押されたときに呼ぶ</span></li>
            </ul>
          </section>
          <section className="border-warning bg-warning-bg rounded-card border p-5">
            <h2 className="text-ink font-semibold">気をつけること</h2>
            <ul className="text-ink-secondary mt-2 space-y-2 text-sm leading-6">
              <li><strong>同じアクションを呼び合わせない</strong><br />循環は公開前の検査で止めます。</li>
              <li><strong>外に送る処理は、やり直しに気をつける</strong><br />同じものを2回送らない目印を付けます。</li>
            </ul>
          </section>
        </aside>
      </div>

      {error ? <p className="text-danger mt-4 text-sm" role="alert">{error}</p> : null}
      <StickyBar
        status={saving ? '下書きを保存しています' : 'まだ保存していません'}
        actions={(
          <>
            <Button href="/common-actions">作成をやめる</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || resourcesLoading}>
              {saving ? '保存中' : '下書きに保存'}
            </Button>
          </>
        )}
      />
      <style jsx global>{`
        @media (min-width: 1280px) { .common-action-editor-grid { grid-template-columns: minmax(0, 1fr) 390px; } }
        .compact-common-action-editor section { background: var(--color-canvas-sunken); padding: 12px; }
        .compact-common-action-editor section > div:first-child { margin-bottom: 8px; }
        .compact-common-action-editor textarea { min-height: 64px; }
      `}</style>
    </div>
  )
}
