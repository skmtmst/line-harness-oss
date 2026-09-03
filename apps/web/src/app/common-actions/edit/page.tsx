'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  ApiError,
  type CommonActionResources,
  type CommonActionStep,
} from '@/lib/api'
import CommonActionEditor from '@/components/automations/common-action-editor'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { TextArea, TextField } from '@/components/shared/text-field'

const EMPTY_RESOURCES: CommonActionResources = {
  tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [],
}
function EditCommonActionInner() {
  const canManage = useCanManageCommonActions()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [actions, setActions] = useState<CommonActionStep[]>([])
  const [draftVersionId, setDraftVersionId] = useState('')
  const [resources, setResources] = useState<CommonActionResources>(EMPTY_RESOURCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accountLoading || canManage !== true || !selectedAccountId) {
      if (!accountLoading) setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.commonActions.get(id, selectedAccountId),
      api.commonActions.resources(selectedAccountId, id),
    ]).then(([detailResponse, resourceResponse]) => {
      if (cancelled) return
      if (!detailResponse.success || !resourceResponse.success) throw new Error('下書きを読み込めませんでした')
      const detail = detailResponse.data
      const draft = detail.versions.find((version) => version.id === detail.currentDraftVersionId)
      if (!draft) throw new Error('編集中の下書きがありません。版の画面から新版を作ってください。')
      setName(detail.name)
      setDescription(detail.description ?? '')
      setActions(draft.actions)
      setDraftVersionId(draft.id)
      setResources(resourceResponse.data)
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : '下書きを読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [accountLoading, canManage, id, selectedAccountId])

  const save = async () => {
    if (!selectedAccountId || !draftVersionId) {
      setError('編集中の下書きを確認できません')
      return
    }
    if (!name.trim() || actions.length === 0) {
      setError(!name.trim() ? '共通アクション名を入力してください' : '処理を1つ以上追加してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.commonActions.updateDraft(id, selectedAccountId, {
        expectedDraftVersionId: draftVersionId,
        name: name.trim(),
        description: description.trim() || null,
        actions,
      })
      router.push(`/common-actions/versions?id=${encodeURIComponent(id)}`)
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : '下書きを保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (canManage === null || loading) return <div className="border-hairline rounded-card border bg-canvas p-10 text-center text-sm text-ink-faint" aria-busy="true">下書きを読み込んでいます</div>
  if (!canManage) return (
    <div className="border-hairline rounded-card border bg-canvas p-6">
      {/*
        **画面名はトップバーが出すので、ここで `<h1>` を作らない。**
        権限不足は「この画面が何か」ではなく「いまどの状態か」なので、
        見出しの階層を1つ下げて `<h2>` にする。
      */}
      <h2 className="text-ink text-lg font-semibold">共通アクションは閲覧のみです</h2>
      <p className="text-ink-secondary mt-2 text-sm">編集するには、オーナーまたは管理者の権限が必要です。</p>
      <Button href="/common-actions" className="mt-4">共通アクション一覧へ戻る</Button>
    </div>
  )

  return (
    <div data-design-node="py5CG" className="pb-24">
      <PageHeader
        breadcrumb={[
          { label: '共通アクション', href: '/common-actions' },
          { label: '版と使われている場所', href: `/common-actions/versions?id=${encodeURIComponent(id)}` },
          { label: '下書きの中身を編集' },
        ]}
        title="下書きの中身を編集"
        description="公開済みの版は変えず、新しい下書きだけを編集します。"
      />

      {error && !draftVersionId ? (
        <div className="border-danger bg-danger-bg text-danger rounded-card border p-6" role="alert">
          <p className="font-semibold">下書きを編集できません</p>
          <p className="mt-1 text-sm">{error}</p>
          <Button href={`/common-actions/versions?id=${encodeURIComponent(id)}`} className="mt-4">版の画面へ戻る</Button>
        </div>
      ) : (
        <>
          <div className="common-action-editor-grid grid items-start gap-4">
            <div className="space-y-4">
              <section className="border-hairline rounded-card border bg-canvas p-5">
                <h2 className="text-ink font-semibold">名前と説明</h2>
                <div className="mt-4 space-y-4">
                  <label className="text-ink-secondary block text-sm">共通アクション名<TextField value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1" /></label>
                  <label className="text-ink-secondary block text-sm">説明<TextArea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1" /></label>
                </div>
              </section>
              <section>
                <h2 className="text-ink mb-3 font-semibold">順番に動かす処理</h2>
                <CommonActionEditor value={actions} resources={resources} onChange={setActions} />
              </section>
            </div>
            <aside className="space-y-4 xl:sticky xl:top-4">
              <section className="border-hairline rounded-card border bg-canvas p-5">
                <h2 className="text-ink font-semibold">保存しても利用先は変わりません</h2>
                <p className="text-ink-secondary mt-2 text-sm leading-6">下書きを保存したあと、版の画面で公開します。さらに利用先ごとの更新が必要です。</p>
              </section>
              <section className="border-warning bg-warning-bg rounded-card border p-5">
                <h2 className="text-ink font-semibold">公開前の確認</h2>
                <p className="text-ink-secondary mt-2 text-sm leading-6">参照先、失敗時の動き、処理の順番が正しいかを確認してください。循環や使えない参照は公開時に止まります。</p>
              </section>
            </aside>
          </div>
          {error ? <p className="text-danger mt-4 text-sm" role="alert">{error}</p> : null}
          <StickyBar
            status={saving ? '下書きを保存しています' : '公開済みの版には影響しません'}
            actions={(
              <>
                <Button href={`/common-actions/versions?id=${encodeURIComponent(id)}`}>編集をやめる</Button>
                <Button variant="primary" onClick={() => void save()} disabled={saving}>下書きを保存</Button>
              </>
            )}
          />
          <style jsx>{`@media (min-width: 1280px) { .common-action-editor-grid { grid-template-columns: minmax(0, 1fr) 390px; } }`}</style>
        </>
      )}
    </div>
  )
}

export default function EditCommonActionPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">下書きを読み込んでいます</div>}>
      <EditCommonActionInner />
    </Suspense>
  )
}
