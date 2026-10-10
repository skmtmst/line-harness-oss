'use client'
import { notifySaved, notifyToast } from '@/components/shared/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure, type TagDefinition, type TagDependencies } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import { folderCreateResult } from '@/components/shared/folder-select'
import TargetMissing from '@/components/shared/target-missing'
import { ArchivedTagEditor, DeleteDialog } from '@/components/friend-fields/edit-tag-page-v4'
import { definitionsForSave, linkedActionFromDefinition, type TagEditorValues } from '@/components/friend-fields/tag-editor-v4'
import { describeTagDiff } from './conflict-diff'
import styles from './edit.module.css'
import { TagEditForm } from './edit-form'
import { withPermissionFailure } from '@/components/shared/api-error-message'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import ReadOnlyNotice from '@/components/shared/read-only-notice'

/*
 * ★V8 タグ：タグの編集（一から書いた画面・2026-10-07）。
 * Pencil：タグの編集 `Qat9s`、競合 `xn95q`、閲覧のみ `fkGUR`。
 *
 * 型は「作る」（CreatePage）：頭（戻る・タグ名・フォルダと人数）→ 左に「基本」「タグ連動」「マイル」、
 * 右に「使っている所」、下の帯（削除は左端・キャンセル／複製して作る／保存は中央）。
 * 「タグ連動」「マイル」は畳んで1行の要約を出し、「開く」で中身を出す（絵どおり）。
 * 動き（読み込み・保存・さかのぼり反映の確認・競合・削除・アーカイブ）は今の画面（app/tags/edit-tag-page-v8）と同じ。
 */

export default function TagEditV8() {
  const saveErrors = useSaveFormErrors()
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'タグ', href: '/tags' }])
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, selectedAccount } = useAccount()
  const tagId = params.get('id') ?? ''
  // 撮影で「さかのぼり反映の確認」を開いた形にする指定（今の画面と同じ）。
  const retroactiveReference = params.get('visualQa') === 'retroactive'
  const [tag, setTag] = useState<Tag | null>(null)
  const [definition, setDefinition] = useState<TagDefinition | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  // その場でタグのフォルダを作る（dLffh）。左の列の「フォルダを追加」と同じ受け口。
  const createGroup = async (name: string, color: string | null) => {
    const generation = requestRef.current
    const response = await api.tagGroups.create({ name, color, accountId: selectedAccountId })
    const created = folderCreateResult(response, (group: TagGroup) => ({ value: group.id, label: group.name, color: group.color }))
    if (targetRef.current !== targetKey || requestRef.current !== generation) throw new Error('編集するタグが変わりました。もう一度選び直してください。')
    if (response.success) setGroups((current) => [...current, response.data])
    return created
  }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [tagMissing, setTagMissing] = useState(false)
  usePageTitle(tag?.name ?? 'タグを編集')
  /* 閲覧のみ（fkGUR）：役割が取れるまでは押せる形（最後の守りはサーバの 403）。 */
  const staffRole = useStaffRole()
  const canEdit = canManageRole(staffRole)
  /* 競合（xn95q）：入力は捨てず、比べる・読み込むを選んでもらう。 */
  const [conflictValues, setConflictValues] = useState<TagEditorValues | null>(null)
  const [compareTarget, setCompareTarget] = useState<TagDefinition | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [dependencies, setDependencies] = useState<TagDependencies | null>(null)
  const [dependenciesStatus, setDependenciesStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const targetKey = `${selectedAccountId ?? ''}:${tagId}`
  const targetRef = useRef(targetKey)
  const targetGenerationRef = useRef(0)
  if (targetRef.current !== targetKey) {
    targetRef.current = targetKey
    targetGenerationRef.current += 1
  }
  const targetGeneration = targetGenerationRef.current
  const requestRef = useRef(0)
  const [editorRevision, setEditorRevision] = useState(0)

  const load = useCallback(async (refresh = false) => {
    const generation = ++requestRef.current
    const stillHere = () => targetRef.current === targetKey && requestRef.current === generation
    if (!tagId || !selectedAccountId) { setLoading(false); return }
    if (!refresh) { setLoading(true); setTag(null); setDefinition(null); setGroups([]); setDependencies(null); setDependenciesStatus('loading') }
    setError('')
    setTagMissing(false)
    try {
      const [detail, dependenciesResult, folders] = await Promise.all([
        api.tags.definition(tagId, selectedAccountId),
        api.tags.dependencies(tagId, selectedAccountId),
        api.tagGroups.list(selectedAccountId),
      ])
      if (!stillHere()) return
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
      if (!stillHere()) return
      const fieldFailure = saveErrors.capture(caught);

      if (caught instanceof ApiError && caught.status === 404) setTagMissing(true)
      else { if (!fieldFailure)
 setError('読み込みに失敗しました。もう一度読み込んでください。') }
      setDependenciesStatus((prev) => (prev === 'ready' ? prev : 'error'))
    } finally {
      if (stillHere()) setLoading(false)
    }
  }, [tagId, selectedAccountId, targetKey, saveErrors])

  useEffect(() => { setConflictValues(null); setCompareTarget(null); setCompareError(''); setCompareBusy(false); setSaving(false); setDeleting(false); setDeleteOpen(false); void load(); return () => { requestRef.current += 1 } }, [load])

  // M956：応答が消えたときの再送用。同じ内容の再送は同じ要求キー、成功したら捨てる。
  const saveKeysRef = useRef(new IdempotencyKeyStore())

  const save = async (values: TagEditorValues, applyRetroactive: boolean, previewToken?: string) => {
    if (!tag || !definition || !selectedAccountId || saving) return
    const savingTarget = targetKey
    const savingGeneration = requestRef.current
    const stillHere = () => targetRef.current === savingTarget && requestRef.current === savingGeneration
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: values.name,
        groupId: values.groupId || null,
        isStarred: values.isStarred,
        manualAssignmentAllowed: tag.manualAssignmentAllowed ?? true,
        reapplyPolicy: values.reapplyPolicy,
        linkedEnabled: values.linked,
        mileage: { self: values.rewardMiles, referrer: values.referralRewardMiles, multiplier: values.multiplierBps, priority: values.multiplierPriority },
        actions: definitionsForSave(values.actions),
        applyToExisting: applyRetroactive && values.applyToExisting,
        ...(previewToken ? { previewToken } : {}),
        automationId: definition.automation?.id ?? null,
        automationDraftVersion: definition.automation?.draftVersion?.id ?? null,
      }
      const { previewToken: _ignored, ...sigPayload } = payload
      void _ignored
      const sig = JSON.stringify({ target: savingTarget, version: tag.version ?? 1, payload: sigPayload })
      const update = await api.tags.updateDefinition(tag.id, selectedAccountId, tag.version ?? 1, payload, saveKeysRef.current.get(sig))
      if (!stillHere()) return
      if (!update.success) throw new Error(update.error)
      saveKeysRef.current.clear(sig)
      notifySaved(update.data.replayed ? '保存済みでした。' : update.data.queued > 0 ? `保存しました。${update.data.queued}人へ遡及反映を開始しました。` : '保存しました。')
      setConflictValues(null)
      await load(true)
    } catch (reason) {
      if (!stillHere()) return
      const fieldFailure = saveErrors.capture(reason);

      if (reason instanceof ApiError && reason.status === 409) setConflictValues(values)
      else { if (!fieldFailure)
 setError(withPermissionFailure(reason, describeSaveFailure(reason), 'store')) }
    } finally {
      if (targetRef.current === savingTarget && targetGenerationRef.current === targetGeneration) setSaving(false)
    }
  }

  const reloadAfterConflict = async () => {
    setCompareTarget(null)
    setCompareError('')
    setConflictValues(null)
    setError('')
    setEditorRevision((current) => current + 1)
    await load()
  }

  const openCompare = async () => {
    if (compareBusy || !tagId || !selectedAccountId) return
    const generation = requestRef.current
    const stillHere = () => targetRef.current === targetKey && requestRef.current === generation
    setCompareBusy(true)
    setCompareError('')
    try {
      const detail = await api.tags.definition(tagId, selectedAccountId)
      if (!stillHere()) return
      if (!detail.success) throw new Error(detail.error)
      setCompareTarget(detail.data)
    } catch (saveFailure) {
      if (!stillHere()) return
      const fieldFailure = saveErrors.capture(saveFailure)
      { if (!fieldFailure)
      setCompareError('最新の内容を取れませんでした。もう一度お試しください。') }
    } finally {
      if (stillHere()) setCompareBusy(false)
    }
  }

  const remove = async () => {
    if (!tag || deleting) return
    const generation = requestRef.current
    const stillHere = () => targetRef.current === targetKey && requestRef.current === generation
    setDeleting(true)
    try {
      const result = await api.tags.delete(tag.id)
      if (!stillHere()) return
      if (!result.success) throw new Error(result.error)
      router.push('/tags')
    } catch (reason) {
      if (!stillHere()) return
      const fieldFailure = saveErrors.capture(reason)
      { if (!fieldFailure)

      setError(reason instanceof Error ? reason.message : '削除に失敗しました。通信を確かめて、もう一度お試しください。') }
      setDeleteOpen(false)
    } finally {
      if (stillHere()) setDeleting(false)
    }
  }

  if (loading) return <SaveErrorScope errors={saveErrors}><p className={styles.loading} role="status">読み込み中…</p></SaveErrorScope>
  if (!tagId) {
    return <SaveErrorScope errors={saveErrors}><TargetMissing kind="unspecified" title="編集するタグが指定されていません" description="一覧から編集するタグを選び直してください。" backHref="/tags" backLabel="タグ一覧へ戻る" /></SaveErrorScope>
  }
  if (!selectedAccountId) return <SaveErrorScope errors={saveErrors}><Notice tone="warn">LINE公式アカウントを選んでください。</Notice></SaveErrorScope>
  if ((!tag || !definition) && (tagMissing || !error)) {
    return <SaveErrorScope errors={saveErrors}><TargetMissing kind="not-found" title="このタグは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" accountName={selectedAccount?.name} backHref="/tags" backLabel="タグ一覧へ戻る" /></SaveErrorScope>
  }
  if (!tag || !definition) {
    return <SaveErrorScope errors={saveErrors}><TargetMissing kind="error" title="タグを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} /></SaveErrorScope>
  }
  // アーカイブのタグは通常の編集を出さない（#710）。
  if (tag.status === 'archived') {
    if (!canEdit) return <SaveErrorScope errors={saveErrors}><ReadOnlyNotice>閲覧のみで見ています。変える操作は管理者に頼んでください。</ReadOnlyNotice></SaveErrorScope>
    return <SaveErrorScope errors={saveErrors}><ArchivedTagEditor tag={tag} accountId={selectedAccountId} onCancel={() => router.push('/tags')} onSaved={(updated) => { if (targetRef.current === targetKey && targetGenerationRef.current === targetGeneration) setTag((current) => (current ? { ...current, ...updated } : current)) }} /></SaveErrorScope>
  }

  return (
    <SaveErrorScope errors={saveErrors}><>
      <TagEditForm
        key={`${targetKey}:${editorRevision}`}
        tag={tag}
        groups={groups}
        onCreateGroup={canEdit && selectedAccountId ? createGroup : undefined}
        dependencies={dependencies}
        accountId={selectedAccountId}
        readOnly={!canEdit}
        conflict={conflictValues !== null}
        compareBusy={compareBusy}
        onCompare={() => void openCompare()}
        onReloadLatest={() => void reloadAfterConflict()}
        retroactiveReference={retroactiveReference}
        initialActions={(definition.automation?.actions ?? []).map((action) => linkedActionFromDefinition(action, tag.linkedActions?.find((saved) => saved.id === action.id)))}
        saving={saving}
        error={error}
        onCancel={() => router.push('/tags')}
        onSave={save}
        onDelete={() => setDeleteOpen(true)}
      />
      {deleteOpen ? <DeleteDialog tag={tag} dependencies={dependencies} dependenciesStatus={dependenciesStatus} deleting={deleting} onCancel={() => setDeleteOpen(false)} onDelete={() => void remove()} /> : null}
      <ConfirmDialog
        open={compareTarget !== null || compareError !== ''}
        title="最新の保存と比べる"
        description="あなたの入力と、相手が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
        confirmLabel="最新を読み込んで続ける"
        busy={compareBusy}
        error={compareError || undefined}
        onConfirm={() => reloadAfterConflict()}
        onCancel={() => {
          setCompareTarget(null)
          setCompareError('')
        }}
      >
        {compareTarget && conflictValues ? (() => {
          const lines = describeTagDiff(conflictValues, compareTarget)
          return lines.length === 0
            ? <p className={styles.diffEmpty}>違いは見つかりませんでした。そのまま読み込めます。</p>
            : <ul className={styles.diffList}>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        })() : null}
      </ConfirmDialog>
    </></SaveErrorScope>
  )
}

export { TagEditForm, type TagEditHost } from './edit-form'
