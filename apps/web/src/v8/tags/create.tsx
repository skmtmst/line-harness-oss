'use client'

/*
 * ★V8「タグを作る」（Pencil `d9xoI`）。
 *
 * 型（CreatePage）に、段「基本」（タグ名・所属フォルダ・友だち一覧に出す）と段「付け方（どこで付けるか）」、
 * 右の列「このあと」、下の帯（キャンセル・保存して続けて作る・タグを作る）を渡す。
 * 読み込み・複製元・保存の口は今の作る画面（app/tags/new-tag-page-v8.tsx）と同じ。
 * 違うのは見せ方：タグ連動（付いたときの動き）は絵のとおり「作ったあとの編集で足す」。
 * 複製して作る（?copy=）ときは、複製元の連動の中身は画面に出さずにそのまま写して作る。
 */
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ClipboardList, Link2, Plus, Workflow } from 'lucide-react'
import type { TagGroup } from '@line-crm/shared'
import { api, type TagDefinition } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import ListState from '@/components/shared/list-state'
import { notifyToast } from '@/components/shared/toast'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import { definitionsForSave, linkedActionFromDefinition } from '@/components/friend-fields/tag-editor-v4'
import styles from './create.module.css'

/** 作る前の検査（今の作る画面と同じ）。問題なければ null。 */
export function tagNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'タグ名を入力してください'
  if (trimmed.length > 80) return 'タグ名は80文字までで入力してください'
  if ([...trimmed].some((ch) => { const code = ch.charCodeAt(0); return code < 32 || code === 127 })) return 'タグ名に使えない文字が含まれています'
  return null
}

export default function TagCreateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <TagCreate />
    </Suspense>
  )
}

function TagCreate() {
  usePageTitle('タグを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }])
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const copyId = params.get('copy') ?? ''
  /* 直前に作ったタグの名前。URL に残すので再読み込みでも消えない。 */
  const createdName = params.get('created') ?? ''

  const [groups, setGroups] = useState<TagGroup[]>([])
  const [foldersFailed, setFoldersFailed] = useState(false)
  const [foldersReloadKey, setFoldersReloadKey] = useState(0)
  const [copySource, setCopySource] = useState<TagDefinition | null>(null)
  const [copyError, setCopyError] = useState('')
  const [loading, setLoading] = useState(Boolean(copyId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [siblings, setSiblings] = useState<Array<{ id: string; name: string }>>([])

  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [isStarred, setIsStarred] = useState(false)
  const dirty = Boolean(name.trim() || groupId || isStarred)
  const guard = useUnsavedGuard({ dirty, busy: saving })

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setGroups([])
      setFoldersFailed(false)
      return
    }
    setFoldersFailed(false)
    void api.tagGroups.list(selectedAccountId).then((folders) => {
      if (cancelled) return
      if (folders.success) setGroups(folders.data.filter((group) => group.accountId === selectedAccountId))
      else setFoldersFailed(true)
    }).catch(() => { if (!cancelled) setFoldersFailed(true) })
    return () => { cancelled = true }
  }, [selectedAccountId, foldersReloadKey])

  /* 同じ名前のタグがすでにあるとき、保存する前に知らせる（IDEA-04）。失敗しても注意が出ないだけ。 */
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    void api.tags.list({ accountId: selectedAccountId })
      .then((res) => { if (!cancelled && res.success) setSiblings(res.data.map((item) => ({ id: item.id, name: item.name }))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedAccountId])
  const duplicates = useMemo(() => findDuplicateNames(siblings, name, null), [siblings, name])

  useEffect(() => {
    let cancelled = false
    setCopySource(null)
    setCopyError('')
    if (!copyId || !selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    void api.tags.definition(copyId, selectedAccountId).then((definition) => {
      if (cancelled) return
      if (definition?.success) {
        setCopySource(definition.data)
        setName(`${definition.data.tag.name} のコピー`)
        setGroupId(definition.data.tag.groupId ?? '')
        setIsStarred(definition.data.tag.isStarred ?? false)
      } else setCopyError('複製元のタグを読み込めませんでした')
    }).catch(() => {
      if (!cancelled) setCopyError('複製元のタグを読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [copyId, selectedAccountId])

  const save = async (andAnother: boolean) => {
    if (saving) return
    const problem = tagNameProblem(name)
    if (problem) {
      setError(problem)
      return
    }
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return
    }
    setSaving(true)
    setError('')
    const trimmed = name.trim()
    /* 複製のときは連動（マイル・動き）も写す。ふつうに作るときは連動なし（作ったあとの編集で足す）。 */
    const source = copySource?.tag
    const linked = Boolean(source?.linkedEnabled)
    try {
      const created = await api.tags.createDefinition(selectedAccountId, {
        name: trimmed,
        groupId: groupId || null,
        isStarred,
        manualAssignmentAllowed: true,
        reapplyPolicy: source?.reapplyPolicy ?? 'first_only',
        linkedEnabled: linked,
        mileage: linked
          ? { self: source?.mileageReward ?? 0, referrer: source?.referralMileageReward ?? 0, multiplier: source?.mileageMultiplierBps ?? null, priority: source?.mileageMultiplierPriority ?? 0 }
          : { self: 0, referrer: 0, multiplier: null, priority: 0 },
        actions: linked && copySource
          ? definitionsForSave((copySource.automation?.actions ?? []).map((action) => linkedActionFromDefinition(
            action,
            copySource.tag.linkedActions?.find((saved) => saved.id === action.id),
          )))
          : [],
      })
      if (!created.success) throw new Error(created.error)
      guard.disarm()
      notifyToast(`「${trimmed}」を作りました`)
      if (andAnother) {
        const next = new URLSearchParams()
        if (copyId) next.set('copy', copyId)
        next.set('created', trimmed)
        setName('')
        setGroupId('')
        setIsStarred(false)
        router.push(`/tags/new?${next}`)
      } else {
        router.push(`/tags?highlight=${created.data.tag.id}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ListState kind="loading" title="複製元を読み込んでいます…" />

  const back = <Link href="/tags" className={styles.backLink}>← 友だち属性へ</Link>
  const groupOptions = [{ value: '', label: '未分類' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]

  return (
    <>
      <CreatePage
        boardId="d9xoI"
        title="タグを作る"
        identity={back}
        preview={(
          <div className={styles.aside}>
            <h2 className={styles.asideTitle}>このあと</h2>
            <p className={styles.asideText}>作ると、すぐに友だちへ付けられます。タグ連動（付いたときの動き）は作ったあとの編集で足します。</p>
          </div>
        )}
        footerActions={<>
          <Button type="button" onClick={() => guard.guarded(() => router.push('/tags'))} disabled={saving}>キャンセル</Button>
          <Button type="button" onClick={() => void save(true)} disabled={saving}><Plus size={15} aria-hidden="true" />保存して続けて作る</Button>
          <Button type="button" variant="primary" onClick={() => void save(false)} busy={saving} busyLabel="作っています…"><Check size={15} aria-hidden="true" />タグを作る</Button>
        </>}
      >
        {createdName ? <Notice tone="success" message={`「${createdName}」を作成しました。続けて新しいタグを作れます。`} /> : null}
        {error || copyError ? <Notice tone="danger" message={error || copyError} /> : null}

        <section className={styles.card} aria-labelledby="tag-new-basic">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="tag-new-basic">基本</h2>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>タグ名</span>
            <input
              className={styles.input}
              value={name}
              maxLength={80}
              placeholder="例：定期購入者"
              aria-required="true"
              onChange={(event) => setName(event.target.value)}
            />
            <DuplicateNameNote duplicates={duplicates} kindLabel="タグ" />
          </label>
          <div className={styles.field}>
            <span className={styles.label} id="tag-new-folder">所属フォルダ</span>
            <span className={styles.selectBox}>
              <Select size="full" aria-label="所属フォルダ" value={groupId} onChange={setGroupId} options={groupOptions} />
            </span>
            {foldersFailed ? (
              <div className={styles.inlineRetry}>
                <p className={styles.fieldError} role="alert">フォルダを読み込めませんでした。未分類のまま作れます。</p>
                <Button type="button" variant="text" onClick={() => setFoldersReloadKey((key) => key + 1)}>フォルダを読み直す</Button>
              </div>
            ) : null}
          </div>
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>友だち一覧に出す</span>
              <span className={styles.switchNote}>オンにすると、友だち一覧の名前の下にこのタグが出ます</span>
            </span>
            <Toggle checked={isStarred} onChange={setIsStarred} label="友だち一覧に出す" />
          </div>
        </section>

        <section className={styles.card} aria-labelledby="tag-new-ways">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="tag-new-ways">付け方（どこで付けるか）</h2>
            <p className={styles.cardNote}>作ったあとに、回答フォーム・オートメーション・タグ連動からこのタグを付けられます</p>
          </div>
          <div className={styles.waysRow}>
            <Link href="/forms" className={styles.way}>
              <ClipboardList className={styles.wayIcon} aria-hidden="true" />
              <span className={styles.wayTitle}>回答フォーム</span>
              <span className={styles.wayNote}>答えに合わせて付ける</span>
            </Link>
            <Link href="/automations" className={styles.way}>
              <Workflow className={styles.wayIcon} aria-hidden="true" />
              <span className={styles.wayTitle}>オートメーション</span>
              <span className={styles.wayNote}>決まりで自動に付ける</span>
            </Link>
            <div className={styles.way}>
              <Link2 className={styles.wayIcon} aria-hidden="true" />
              <span className={styles.wayTitle}>タグ連動</span>
              <span className={styles.wayNote}>付いたら次の動きをする</span>
            </div>
          </div>
        </section>
      </CreatePage>
      <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="入力したタグ" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </>
  )
}
