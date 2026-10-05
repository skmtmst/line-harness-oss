'use client'

/*
 * ★V8「タグを編集」（Pencil `Qat9s`）の入口。
 *
 * 読み込み・参照件数の確認窓・保管済みタグの扱い・保存・削除は
 * v7（edit-tag-page-v4）と同じ。違うのは中身の部品——`TagEditorV8`。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure, type TagDefinition, type TagDependencies } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import TargetMissing from '@/components/shared/target-missing'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import TagEditorV8 from './tag-editor-v8'
import { describeTagDiff } from './edit/tag-conflict-diff'
import {
  ArchivedTagEditor,
  DeleteDialog,
} from '@/components/friend-fields/edit-tag-page-v4'
import { definitionsForSave, linkedActionFromDefinition, type TagEditorValues } from '@/components/friend-fields/tag-editor-v4'

export default function EditTagPageV8() {
  usePageTitle('タグを編集')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, selectedAccount } = useAccount()
  const tagId = params.get('id') ?? ''
  const retroactiveReference = params.get('visualQa') === 'retroactive'
  const [tag, setTag] = useState<Tag | null>(null)
  const [definition, setDefinition] = useState<TagDefinition | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tagMissing, setTagMissing] = useState(false)
  /*
   * 閲覧のみ（`fkGUR`）は一覧と同じ境目——役割が取れるまでは
   * 押せる見た目にしておく（最後の守りはサーバの 403）。
   */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  /*
   * 編集の競合（`xn95q`）。入力は捨てず、比べる・読み込むを
   * 選んでもらう（reminders の k32cn と同じ形）。
   */
  const [conflictValues, setConflictValues] = useState<TagEditorValues | null>(null)
  const [compareTarget, setCompareTarget] = useState<TagDefinition | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  /* 削除確認に出す参照件数。取れていないのに開いたら削除は押せない。 */
  const [dependencies, setDependencies] = useState<TagDependencies | null>(null)
  const [dependenciesStatus, setDependenciesStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    if (!tagId || !selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    setTagMissing(false)
    try {
      const [detail, dependenciesResult, folders] = await Promise.all([
        api.tags.definition(tagId, selectedAccountId),
        api.tags.dependencies(tagId, selectedAccountId),
        api.tagGroups.list(selectedAccountId),
      ])
      if (folders.success) setGroups(folders.data.filter((group) => group.accountId === selectedAccountId))
      if (dependenciesResult.success) {
        setDependencies(dependenciesResult.data)
        setDependenciesStatus('ready')
      } else {
        setDependencies(null)
        setDependenciesStatus('error')
      }
      if (!detail.success) throw new Error(detail.error)
      setDefinition(detail.data)
      setTag({ ...detail.data.tag, friendCount: dependenciesResult.success ? dependenciesResult.data.friendCount : detail.data.tag.friendCount })
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setTagMissing(true)
      } else {
        setError('読み込みに失敗しました。もう一度読み込んでください。')
      }
      setDependenciesStatus((prev) => (prev === 'ready' ? prev : 'error'))
    } finally {
      setLoading(false)
    }
  }, [tagId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  // M956: 応答消失後の再送用。同じ内容の再送は同じ要求キー、成功したら捨てる。
  const saveKeysRef = useRef(new IdempotencyKeyStore())

  const save = async (values: TagEditorValues, _andAnother: boolean, applyRetroactive: boolean, previewToken?: string) => {
    if (!tag || !definition || !selectedAccountId || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const actionsForSave = definitionsForSave(values.actions)
      const payload = {
        name: values.name,
        groupId: values.groupId || null,
        isStarred: values.isStarred,
        manualAssignmentAllowed: tag.manualAssignmentAllowed ?? true,
        reapplyPolicy: values.reapplyPolicy,
        linkedEnabled: values.linked,
        mileage: { self: values.rewardMiles, referrer: values.referralRewardMiles, multiplier: values.multiplierBps, priority: values.multiplierPriority },
        actions: actionsForSave,
        applyToExisting: applyRetroactive && values.applyToExisting,
        ...(previewToken ? { previewToken } : {}),
        automationId: definition.automation?.id ?? null,
        automationDraftVersion: definition.automation?.draftVersion?.id ?? null,
      }
      const { previewToken: _ignored, ...sigPayload } = payload
      void _ignored
      const sig = JSON.stringify(sigPayload)
      const update = await api.tags.updateDefinition(tag.id, selectedAccountId, tag.version ?? 1, payload, saveKeysRef.current.get(sig))
      if (!update.success) throw new Error(update.error)
      saveKeysRef.current.clear(sig)
      if (update.data.replayed) {
        setNotice('保存済みでした。')
      } else {
        setNotice(update.data.queued > 0 ? `保存しました。${update.data.queued}人へ遡及反映を開始しました。` : '保存しました。')
      }
      await load()
    } catch (reason) {
      // 409 は競合の帯へ出す（`xn95q`）。入力中の値は残す。
      if (reason instanceof ApiError && reason.status === 409) {
        setConflictValues(values)
      } else {
        setError(describeSaveFailure(reason))
      }
    } finally {
      setSaving(false)
    }
  }

  // `xn95q`「最新を読み込んで続ける」。入力中の内容は最新の版で置き換わる。
  const reloadAfterConflict = async () => {
    setCompareTarget(null)
    setCompareError('')
    setConflictValues(null)
    setError('')
    await load()
  }

  // `xn95q`「違いを比べる」。最新を取って比べるだけで、画面は書き換えない。
  const openCompare = async () => {
    if (compareBusy || !tagId || !selectedAccountId) return
    setCompareBusy(true)
    setCompareError('')
    try {
      const detail = await api.tags.definition(tagId, selectedAccountId)
      if (!detail.success) throw new Error(detail.error)
      setCompareTarget(detail.data)
    } catch {
      setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
    } finally {
      setCompareBusy(false)
    }
  }

  const remove = async () => {
    if (!tag || deleting) return
    setDeleting(true)
    try {
      const result = await api.tags.delete(tag.id)
      if (!result.success) throw new Error(result.error)
      router.push('/tags')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '削除に失敗しました。通信を確かめて、もう一度お試しください。')
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-ink-faint">読み込み中…</p>
  if (!tagId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集するタグが指定されていません"
        description="一覧から編集するタグを選び直してください。"
        backHref="/tags"
        backLabel="タグ一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return <Notice tone="warn">LINE公式アカウントを選んでください。</Notice>
  if ((!tag || !definition) && (tagMissing || !error)) {
    return (
      <TargetMissing
        kind="not-found"
        title="このタグは見つかりません"
        description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。"
        accountName={selectedAccount?.name}
        backHref="/tags"
        backLabel="タグ一覧へ戻る"
      />
    )
  }
  if (!tag || !definition) {
    return (
      <TargetMissing
        kind="error"
        title="タグを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  // 保管済み(archived)タグは、通常の編集フォームを出さない(#710)。
  if (tag.status === 'archived') {
    return (
      <ArchivedTagEditor
        tag={tag}
        accountId={selectedAccountId}
        onCancel={() => router.push('/tags')}
        onSaved={(updated) => setTag((current) => (current ? { ...current, ...updated } : current))}
      />
    )
  }

  return (
    <>
      {!canEdit ? (
        <div className="border-accent bg-accent-soft rounded-card flex flex-wrap items-center gap-3 border p-4" data-design-node="fkGUR" role="note">
          <p className="text-ink min-w-0 flex-1 text-sm">
            閲覧のみで見ています。変える操作は管理者に頼んでください。
          </p>
        </div>
      ) : null}
      {conflictValues ? (
        <div className="border-accent bg-accent-soft rounded-card flex flex-wrap items-center gap-3 border p-4" data-design-node="xn95q" role="alert">
          <p className="text-ink min-w-0 flex-1 text-sm">
            ほかの人が先に保存しました。
            <span className="text-ink-secondary mt-0.5 block text-xs">
              あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void openCompare()} disabled={compareBusy}>
              {compareBusy ? '比べています...' : '違いを比べる'}
            </Button>
            <Button type="button" variant="primary" onClick={() => void reloadAfterConflict()}>
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : null}
      <TagEditorV8
        key={`${tag.id}:${tag.version ?? 1}`}
        mode="edit"
        groups={groups}
        tag={tag}
        accountId={selectedAccountId}
        readOnly={!canEdit}
        initialApplyToExisting={retroactiveReference}
        initialRetroactiveOpen={retroactiveReference}
        referenceRetroactiveState={retroactiveReference}
        initialValues={{
          reapplyPolicy: tag.reapplyPolicy ?? 'first_only',
          actions: (definition.automation?.actions ?? []).map((action) => linkedActionFromDefinition(action, tag.linkedActions?.find((saved) => saved.id === action.id))),
        }}
        saving={saving}
        error={error}
        notice={notice}
        onCancel={() => router.push('/tags')}
        onSave={save}
        onDelete={() => setDeleteOpen(true)}
      />
      {deleteOpen && <DeleteDialog tag={tag} dependencies={dependencies} dependenciesStatus={dependenciesStatus} deleting={deleting} onCancel={() => setDeleteOpen(false)} onDelete={() => void remove()} />}
      <ConfirmDialog
        open={compareTarget !== null || compareError !== ''}
        title="最新の保存と比べる"
        description="あなたの入力と、相手が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
        confirmLabel="最新を読み込んで続ける"
        busy={compareBusy}
        error={compareError || undefined}
        onConfirm={() => void reloadAfterConflict()}
        onCancel={() => {
          setCompareTarget(null)
          setCompareError('')
        }}
      >
        {compareTarget && conflictValues ? (
          (() => {
            const lines = describeTagDiff(conflictValues, compareTarget)
            return lines.length === 0 ? (
              <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {lines.map((line, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span aria-hidden className="text-accent-deep font-bold">・</span>
                    <span className="text-ink">{line}</span>
                  </li>
                ))}
              </ul>
            )
          })()
        ) : null}
      </ConfirmDialog>
    </>
  )
}
