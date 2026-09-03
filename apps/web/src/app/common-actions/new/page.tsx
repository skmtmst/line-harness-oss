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
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { TextArea, TextField } from '@/components/shared/text-field'

const EMPTY_RESOURCES: CommonActionResources = {
  tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [],
}
export default function NewCommonActionPage() {
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
      <PageHeader
        breadcrumb={[
          { label: '共通アクション', href: '/common-actions' },
          { label: '共通アクションをつくる' },
        ]}
        title="共通アクションをつくる"
        description="上から順に、名前・処理・失敗時の動きを決めます。"
      />

      <div className="common-action-editor-grid grid items-start gap-4">
        <div className="space-y-4">
          <section className="border-hairline rounded-card border bg-canvas p-5">
            <h2 className="text-ink font-semibold">名前と説明</h2>
            <div className="mt-4 space-y-4">
              <label className="text-ink-secondary block text-sm">
                共通アクション名
                <TextField value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1" placeholder="例：来店後のお礼を送る" />
              </label>
              <label className="text-ink-secondary block text-sm">
                説明
                <TextArea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1" placeholder="使う場面や目的を書きます" />
              </label>
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="text-ink font-semibold">順番に動かす処理</h2>
              <p className="text-ink-faint mt-1 text-sm">上から順に実行します。公開後の版は書き換わりません。</p>
            </div>
            {resourcesLoading ? (
              <div className="border-hairline rounded-card border bg-canvas p-8 text-center text-sm text-ink-faint">選択肢を読み込んでいます</div>
            ) : (
              <CommonActionEditor value={actions} resources={resources} onChange={setActions} />
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="border-hairline rounded-card border bg-canvas p-5">
            <h2 className="text-ink font-semibold">このあと</h2>
            <ol className="text-ink-secondary mt-3 space-y-3 text-sm">
              <li>1. ここでは下書きとして保存します</li>
              <li>2. 内容を確認して版を公開します</li>
              <li>3. 利用先ごとに使う版を選びます</li>
            </ol>
          </section>
          <section className="border-warning bg-warning-bg rounded-card border p-5">
            <h2 className="text-ink font-semibold">気をつけること</h2>
            <p className="text-ink-secondary mt-2 text-sm leading-6">
              新しい版を公開しても、すでに使っている場所は自動で切り替わりません。動いている処理の中身を途中で変えないためです。
            </p>
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
      <style jsx>{`@media (min-width: 1280px) { .common-action-editor-grid { grid-template-columns: minmax(0, 1fr) 390px; } }`}</style>
    </div>
  )
}
