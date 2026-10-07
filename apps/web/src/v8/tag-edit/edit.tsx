'use client'

/*
 * ★V8 友だち属性：タグの編集（一から書いた画面・2026-10-07）。
 * Pencil：タグの編集 `Qat9s`、競合 `xn95q`、閲覧のみ `fkGUR`。
 *
 * 型は「作る」（CreatePage）：頭（戻る・タグ名・フォルダと人数）→ 左に「基本」「タグ連動」「マイル」、
 * 右に「使っている所」、下の帯（削除は左端・キャンセル／複製して作る／保存は中央）。
 * 「タグ連動」「マイル」は畳んで1行の要約を出し、「開く」で中身を出す（絵どおり）。
 * 動き（読み込み・保存・さかのぼり反映の確認・競合・削除・保管済み）は今の画面（app/tags/edit-tag-page-v8）と同じ。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronUp, Copy, GitCompare, Info, Plus, Save, Trash2 } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure, type TagDefinition, type TagDependencies, type TagRetroactivePreview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { formatDay } from '@/lib/format'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import { DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import { ArchivedTagEditor, DeleteDialog } from '@/components/friend-fields/edit-tag-page-v4'
import {
  ActionDrawer,
  RetroactiveDialog,
  definitionsForSave,
  linkedActionFromDefinition,
  type LinkedAction,
  type TagEditorValues,
} from '@/components/friend-fields/tag-editor-v4'
import { describeTagDiff } from './conflict-diff'
import { MULTIPLIERS, PRIORITIES, actionsSummary, buildUsageRows, mileageSummary } from './model'
import styles from './edit.module.css'

export default function TagEditV8() {
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }])
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, selectedAccount } = useAccount()
  const tagId = params.get('id') ?? ''
  // 撮影で「さかのぼり反映の確認」を開いた形にする指定（今の画面と同じ）。
  const retroactiveReference = params.get('visualQa') === 'retroactive'
  const [tag, setTag] = useState<Tag | null>(null)
  const [definition, setDefinition] = useState<TagDefinition | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [tagMissing, setTagMissing] = useState(false)
  usePageTitle(tag?.name ?? 'タグを編集')
  /* 閲覧のみ（fkGUR）：役割が取れるまでは押せる形（最後の守りはサーバの 403）。 */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  /* 競合（xn95q）：入力は捨てず、比べる・読み込むを選んでもらう。 */
  const [conflictValues, setConflictValues] = useState<TagEditorValues | null>(null)
  const [compareTarget, setCompareTarget] = useState<TagDefinition | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
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
      if (caught instanceof ApiError && caught.status === 404) setTagMissing(true)
      else setError('読み込みに失敗しました。もう一度読み込んでください。')
      setDependenciesStatus((prev) => (prev === 'ready' ? prev : 'error'))
    } finally {
      setLoading(false)
    }
  }, [tagId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  // M956：応答が消えたときの再送用。同じ内容の再送は同じ要求キー、成功したら捨てる。
  const saveKeysRef = useRef(new IdempotencyKeyStore())

  const save = async (values: TagEditorValues, applyRetroactive: boolean, previewToken?: string) => {
    if (!tag || !definition || !selectedAccountId || saving) return
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
      const sig = JSON.stringify(sigPayload)
      const update = await api.tags.updateDefinition(tag.id, selectedAccountId, tag.version ?? 1, payload, saveKeysRef.current.get(sig))
      if (!update.success) throw new Error(update.error)
      saveKeysRef.current.clear(sig)
      notifyToast(update.data.replayed ? '保存済みでした。' : update.data.queued > 0 ? `保存しました。${update.data.queued}人へ遡及反映を開始しました。` : '保存しました。')
      setConflictValues(null)
      await load()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setConflictValues(values)
      else setError(describeSaveFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  const reloadAfterConflict = async () => {
    setCompareTarget(null)
    setCompareError('')
    setConflictValues(null)
    setError('')
    await load()
  }

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

  if (loading) return <p className={styles.loading} role="status">読み込み中…</p>
  if (!tagId) {
    return <TargetMissing kind="unspecified" title="編集するタグが指定されていません" description="一覧から編集するタグを選び直してください。" backHref="/tags" backLabel="タグ一覧へ戻る" />
  }
  if (!selectedAccountId) return <Notice tone="warn">LINE公式アカウントを選んでください。</Notice>
  if ((!tag || !definition) && (tagMissing || !error)) {
    return <TargetMissing kind="not-found" title="このタグは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" accountName={selectedAccount?.name} backHref="/tags" backLabel="タグ一覧へ戻る" />
  }
  if (!tag || !definition) {
    return <TargetMissing kind="error" title="タグを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} />
  }
  // 保管済みのタグは通常の編集を出さない（#710）。
  if (tag.status === 'archived') {
    return <ArchivedTagEditor tag={tag} accountId={selectedAccountId} onCancel={() => router.push('/tags')} onSaved={(updated) => setTag((current) => (current ? { ...current, ...updated } : current))} />
  }

  return (
    <>
      <TagEditForm
        key={`${tag.id}:${tag.version ?? 1}`}
        tag={tag}
        groups={groups}
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
        onConfirm={() => void reloadAfterConflict()}
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
    </>
  )
}

function TagEditForm({
  tag,
  groups,
  dependencies,
  accountId,
  readOnly,
  conflict,
  compareBusy,
  onCompare,
  onReloadLatest,
  retroactiveReference,
  initialActions,
  saving,
  error,
  onCancel,
  onSave,
  onDelete,
}: {
  tag: Tag
  groups: TagGroup[]
  dependencies: TagDependencies | null
  accountId: string
  readOnly: boolean
  conflict: boolean
  compareBusy: boolean
  onCompare: () => void
  onReloadLatest: () => void
  retroactiveReference: boolean
  initialActions: LinkedAction[]
  saving: boolean
  error: string
  onCancel: () => void
  onSave: (values: TagEditorValues, applyRetroactive: boolean, previewToken?: string) => Promise<void>
  onDelete: () => void
}) {
  const [name, setName] = useState(tag.name ?? '')
  const [groupId, setGroupId] = useState(tag.groupId ?? '')
  const [isStarred, setIsStarred] = useState(tag.isStarred ?? false)
  const hasStoredLink = Boolean((tag.mileageReward ?? 0) || (tag.referralMileageReward ?? 0) || tag.mileageMultiplierBps)
  const [linked, setLinked] = useState(hasStoredLink || initialActions.length > 0)
  const [reward, setReward] = useState(String(tag.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(tag.referralMileageReward ?? 0))
  const [multiplier, setMultiplier] = useState(tag.mileageMultiplierBps == null ? '' : String(tag.mileageMultiplierBps))
  const [priority, setPriority] = useState(String(tag.mileageMultiplierPriority ?? 0))
  const [applyToExisting, setApplyToExisting] = useState(retroactiveReference)
  const [reapplyMode, setReapplyMode] = useState<'once' | 'every'>(tag.reapplyPolicy === 'every_time' ? 'every' : 'once')
  const [actions, setActions] = useState<LinkedAction[]>(initialActions)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [retroactiveOpen, setRetroactiveOpen] = useState(retroactiveReference)
  /* 畳んだ段。競合のときは、直した所が見えるように全部開く（xn95q）。 */
  const [actionsOpen, setActionsOpen] = useState(false)
  const [mileageOpen, setMileageOpen] = useState(retroactiveReference)
  useEffect(() => {
    if (!conflict) return
    setActionsOpen(true)
    setMileageOpen(true)
  }, [conflict])
  const actionsRef = useRef<HTMLElement>(null)

  /* IDEA-04：同名のタグがすでにあるとき、保存する前に知らせる。 */
  const [siblingNames, setSiblingNames] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    let cancelled = false
    void api.tags.list({ accountId })
      .then((res) => { if (!cancelled && res.success) setSiblingNames(res.data.map((item) => ({ id: item.id, name: item.name }))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [accountId])
  const nameDuplicates = useMemo(() => findDuplicateNames(siblingNames, name, tag.id), [siblingNames, name, tag.id])

  const groupName = groups.find((group) => group.id === groupId)?.name ?? '未分類'
  const values = useMemo<TagEditorValues>(() => ({
    name: name.trim(), groupId, isStarred, linked,
    rewardMiles: linked ? Number(reward) || 0 : 0,
    referralRewardMiles: linked ? Number(referralReward) || 0 : 0,
    multiplierBps: linked && multiplier ? Number(multiplier) : null,
    multiplierPriority: linked ? Number(priority) || 0 : 0,
    applyToExisting,
    reapplyPolicy: reapplyMode === 'every' ? 'every_time' : 'first_only',
    actions: linked ? actions : [],
  }), [name, groupId, isStarred, linked, reward, referralReward, multiplier, priority, applyToExisting, reapplyMode, actions])

  /* N-047：いま付いている人への反映の人数はサーバーで数える。入力中は少し待ってから数え直す。 */
  const [retroPreview, setRetroPreview] = useState<TagRetroactivePreview | null>(null)
  useEffect(() => {
    if (retroactiveReference) return
    const timer = setTimeout(() => {
      void api.tags.retroactivePreview(tag.id, accountId, { self: values.rewardMiles, referrer: values.referralRewardMiles })
        .then((res) => { if (res.success) setRetroPreview(res.data) })
        .catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [tag.id, accountId, values.rewardMiles, values.referralRewardMiles, retroactiveReference])

  const requestSave = () => {
    if (applyToExisting && (tag.friendCount ?? 0) > 0 && (values.rewardMiles > 0 || values.referralRewardMiles > 0)) {
      setRetroactiveOpen(true)
      return
    }
    void onSave(values, false)
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    setActions((current) => {
      const next = index + direction
      if (next < 0 || next >= current.length) return current
      const reordered = [...current]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(next, 0, moved)
      return reordered
    })
  }
  const duplicateAction = (action: LinkedAction, index: number) => {
    const id = crypto.randomUUID()
    const copy = { ...action, id, definition: action.definition ? { ...action.definition, id } : undefined }
    setActions((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)])
  }
  const removeAction = (id: string) => setActions((current) => current.filter((item) => item.id !== id))

  /* 使っている所：削除の影響確認と同じ数え方（dependencies）。取れないときはタグの一覧の数。 */
  const usageRows = buildUsageRows(dependencies, tag.usedIn)
  /* 競合の帯は共通部品（save-conflict）。絵は `xn95q`（頭の説明の下・横いっぱい）。 */
  const conflictBand = conflict ? (
    <div className={styles.conflictSlot}>
      <SaveConflictBand
        title={`ほかの人がタグ「${tag.name}」を先に保存しました`}
        designNode="xn95q"
        compareBusy={compareBusy}
        onCompare={onCompare}
        onReload={onReloadLatest}
      />
    </div>
  ) : null

  const side = (
    <div className={styles.side}>
      <div className={styles.sideHead}>
        <h2 className={styles.sideTitle}>使っている所</h2>
      </div>
      <dl className={styles.useList}>
        {usageRows.map((row) => (
          <div key={row.label} className={styles.useRow}>
            <dt>{row.label}</dt>
            <dd>
              {row.count > 0 && row.href
                ? <Link href={row.href} className={styles.useLink}>{`${row.count} 件 →`}</Link>
                : <span className={row.count > 0 ? styles.useCount : styles.useNone}>{row.count > 0 ? `${row.count} 件` : row.known ? 'なし' : '—'}</span>}
            </dd>
          </div>
        ))}
        <div className={styles.useRow}>
          <dt>タグ連動</dt>
          <dd>
            {linked && actions.length > 0 ? (
              <button type="button" className={styles.useLink} onClick={() => { setActionsOpen(true); window.requestAnimationFrame(() => actionsRef.current?.scrollIntoView({ block: 'start' })) }}>
                {`${actions.length} つ →`}
              </button>
            ) : <span className={styles.useNone}>なし</span>}
          </dd>
        </div>
      </dl>
      <p className={styles.infoBand}>
        <Info size={16} aria-hidden="true" className={styles.infoIcon} />
        <span>このタグを消すと、上の配信やフォームの条件から外れます。消す前に確認が出ます。</span>
      </p>
    </div>
  )

  return (
    <div className={styles.page}>
      <CreatePage
        title={tag.name || 'タグを編集'}
        identity={<Link href="/tags" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />友だち属性へ</Link>}
        description={(
          <>
            {`${groupName}フォルダ・${tag.friendCount ?? 0}人に付いている・${formatDay(tag.createdAt)}作成`}
            {readOnly ? <p className={styles.roBand} role="note" data-design-node="fkGUR">閲覧のみで見ています。変える操作は管理者に頼んでください。</p> : null}
            {conflictBand}
          </>
        )}
        preview={side}
        destructive={readOnly ? undefined : <Button variant="danger" type="button" onClick={onDelete}>タグを削除する</Button>}
        footerActions={(
          <>
            <Button onClick={onCancel}>キャンセル</Button>
            {/* 閲覧のみには押せない操作を置かない（隠す）。 */}
            {readOnly ? null : <Button href={`/tags/new?copy=${tag.id}`}><Copy size={14} aria-hidden="true" />複製して作る</Button>}
            {readOnly ? null : (
              <Button variant="primary" onClick={conflict ? onCompare : requestSave} busy={saving}>
                {conflict ? <GitCompare size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {conflict ? '比べてから保存' : 'タグを保存する'}
              </Button>
            )}
          </>
        )}
      >
        {error ? <Notice tone="danger" message={error} /> : null}
        <fieldset disabled={readOnly} className={styles.fieldset}>
          <section className={styles.card} aria-label="基本">
            <h2 className={styles.cardTitle}>基本</h2>
            <label className={styles.field}>
              <span className={styles.labelStrong}>タグ名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 定期購入者" className={styles.input} aria-required="true" />
              <DuplicateNameNote duplicates={nameDuplicates} kindLabel="タグ" />
            </label>
            <div className={styles.field}>
              <span className={styles.label}>所属フォルダ</span>
              <div className={styles.folderBox}>
                <Select aria-label="所属フォルダ" value={groupId} onChange={setGroupId} options={[{ value: '', label: '未分類' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} size="full" />
              </div>
            </div>
            <div className={styles.switchRow}>
              <div className={styles.switchText}>
                <span className={styles.label}>友だち一覧に出す</span>
                <span className={styles.hint}>オンにすると、友だち一覧の名前の下にこのタグが出ます</span>
              </div>
              <Toggle checked={isStarred} onChange={setIsStarred} label="友だち一覧に出す" />
            </div>
          </section>

          <section className={styles.card} aria-label="タグ連動" ref={actionsRef}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <div className={styles.titleRow}>
                  <h2 className={styles.cardTitle}>タグ連動（このタグが付いたときの動き）</h2>
                  <HelpTip label="タグ連動の説明">オフのままでも、タグの手動付与・配信の絞り込み・シナリオの条件には使えます。オフに戻すと、これ以降このタグが付いても連動は動きません。すでに積んだマイルは取り消されません。</HelpTip>
                  <span className={styles.titleSpacer} />
                  <span className={styles.linkedState}>{linked ? 'オン' : 'オフ'}</span>
                  <Toggle checked={linked} onChange={setLinked} label="タグ連動" />
                </div>
                <div className={styles.noteRow}>
                  <p className={styles.cardNote}>上から順に動きます。並べ替えは上下の印で</p>
                  {actionsOpen ? <button type="button" className={styles.openButton} onClick={() => setActionsOpen(false)} aria-expanded>閉じる<ChevronUp size={14} aria-hidden="true" /></button> : null}
                </div>
                {actionsOpen ? null : (
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryText}>{actionsSummary(actions, linked)}</span>
                    <span className={styles.titleSpacer} />
                    <button type="button" className={styles.openButton} onClick={() => setActionsOpen(true)} aria-expanded={false}>開く<ChevronDown size={14} aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            </div>
            {actionsOpen ? (
              <>
                {linked ? (
                  <>
                    {actions.length === 0 ? <p className={styles.emptyBox}>連動の動きはまだありません</p> : actions.map((action, index) => (
                      <div key={action.id} className={styles.actionRow}>
                        <span className={styles.actionIndex}>{index + 1}</span>
                        <span className={styles.actionLabel} title={`${action.type}：${action.label}`}>{action.label}</span>
                        {action.timing && action.timing !== 'すぐに' ? <span className={styles.actionTiming}>{action.timing}</span> : null}
                        <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を上へ`} disabled={index === 0} onClick={() => moveAction(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                        <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を下へ`} disabled={index === actions.length - 1} onClick={() => moveAction(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                        <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を複製`} onClick={() => duplicateAction(action, index)}><Copy size={14} aria-hidden="true" /></button>
                        <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を削除`} onClick={() => removeAction(action.id)}><Trash2 size={14} aria-hidden="true" /></button>
                      </div>
                    ))}
                    {readOnly ? null : (
                      <button type="button" className={styles.ghostButton} onClick={() => setDrawerOpen(true)}><Plus size={14} aria-hidden="true" />アクションを追加する</button>
                    )}
                  </>
                ) : <p className={styles.emptyBox}>連動はオフです。右上のスイッチをオンにすると、付いたときの動きとマイルを決められます。</p>}
              </>
            ) : null}
          </section>

          {linked ? (
            <section className={styles.card} aria-label="マイル">
              <div className={styles.cardTitles}>
                <h2 className={styles.cardTitle}>マイル</h2>
                <div className={styles.noteRow}>
                  <p className={styles.cardNote}>このタグが付いている人の、これからのマイルの倍率</p>
                  {mileageOpen ? <button type="button" className={styles.openButton} onClick={() => setMileageOpen(false)} aria-expanded>閉じる<ChevronUp size={14} aria-hidden="true" /></button> : null}
                </div>
                {mileageOpen ? null : (
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryText}>{mileageSummary(multiplier, Number(reward) || 0, Number(referralReward) || 0)}</span>
                    <span className={styles.titleSpacer} />
                    <button type="button" className={styles.openButton} onClick={() => setMileageOpen(true)} aria-expanded={false}>開く<ChevronDown size={14} aria-hidden="true" /></button>
                  </div>
                )}
              </div>
              {mileageOpen ? (
                <>
                  <div className={styles.pair}>
                    <div className={styles.field}>
                      <span className={styles.label}>今後のマイル倍率</span>
                      <div className={styles.selectBox}><Select aria-label="今後のマイル倍率" value={multiplier} onChange={setMultiplier} options={MULTIPLIERS} size="full" /></div>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>倍率の優先度</span>
                      <div className={styles.selectBox}><Select aria-label="倍率の優先度" value={priority} onChange={setPriority} options={PRIORITIES} size="full" /></div>
                    </div>
                  </div>
                  <div className={styles.switchRow}>
                    <div className={styles.switchText}>
                      <span className={styles.label}>今付いている人にもさかのぼって積む（倍率は次の付与から）</span>
                      <span className={styles.hint}>{`オンにすると、すでに付いている ${tag.friendCount ?? 0} 人にも本人・紹介者のマイルをさかのぼって積みます（倍率は次の付与から）。積む前に人数の確認が開きます`}</span>
                    </div>
                    <Toggle checked={applyToExisting} onChange={setApplyToExisting} label="さかのぼって反映" />
                  </div>
                  {applyToExisting ? (
                    <div className={styles.statGrid}>
                      <div className={styles.statBox}><span className={styles.statLabel}>現在の対象者</span><span className={styles.statValue}>{tag.friendCount ?? 0}人</span></div>
                      <div className={styles.statBox}><span className={styles.statLabel}>本人マイル対象</span><span className={styles.statValue}>{retroPreview ? `${retroPreview.selfTargets}人` : retroactiveReference ? `${tag.friendCount ?? 0}人` : '—'}</span></div>
                      <div className={styles.statBox}><span className={styles.statLabel}>紹介者対象</span><span className={styles.statValue}>{retroPreview ? `${retroPreview.referralTargets}人` : '—'}</span></div>
                    </div>
                  ) : null}
                  {retroPreview && (retroPreview.selfExcluded > 0 || retroPreview.referralExcluded > 0) ? (
                    <p className={styles.hint}>{`すでに付与済みの人（本人${retroPreview.selfExcluded}人・紹介者${retroPreview.referralExcluded}人）は対象から外れています。`}</p>
                  ) : null}
                  <div className={styles.subHead}>
                    <h3 className={styles.subTitle}>タグが付いたときに積むマイル</h3>
                  </div>
                  <div className={styles.pair}>
                    <label className={styles.field}>
                      <span className={styles.label}>本人へのマイル付与</span>
                      <span className={styles.numberRow}><input type="number" min={0} value={reward} onChange={(event) => setReward(event.target.value)} className={styles.input} /><span className={styles.unit}>mile</span></span>
                      <span className={styles.hint}>このタグが付いた本人へ、一度だけ積みます。</span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>紹介者へのマイル付与</span>
                      <span className={styles.numberRow}><input type="number" min={0} value={referralReward} onChange={(event) => setReferralReward(event.target.value)} className={styles.input} /><span className={styles.unit}>mile</span></span>
                      <span className={styles.hint}>紹介経由の友だちなら、その紹介者にも積みます。</span>
                    </label>
                  </div>
                  <RadioCardGroup legend="タグを外して付け直したときの扱い" legendVisible>
                    <RadioCard name="reapplyMode" value="once" checked={reapplyMode === 'once'} onChange={() => setReapplyMode('once')} title="最初の1回だけ積む" note="誤操作や付け直しで、同じマイルが重複しません。" />
                    <RadioCard name="reapplyMode" value="every" checked={reapplyMode === 'every'} onChange={() => setReapplyMode('every')} title="付け直すたびに積む" note="購入回数など、同じタグを繰り返し使う運用向けです。" />
                  </RadioCardGroup>
                </>
              ) : null}
            </section>
          ) : null}
        </fieldset>
      </CreatePage>
      {drawerOpen ? <ActionDrawer accountId={accountId} onClose={() => setDrawerOpen(false)} onAdd={(action) => { setActions((current) => [...current, action]); setDrawerOpen(false) }} /> : null}
      {retroactiveOpen ? (
        <RetroactiveDialog
          referenceState={retroactiveReference}
          values={values}
          count={tag.friendCount ?? 0}
          tagId={tag.id}
          accountId={accountId}
          onCancel={() => { setRetroactiveOpen(false); void onSave({ ...values, applyToExisting: false }, false) }}
          onSave={(previewToken) => { setRetroactiveOpen(false); void onSave(values, true, previewToken) }}
        />
      ) : null}
    </div>
  )
}
