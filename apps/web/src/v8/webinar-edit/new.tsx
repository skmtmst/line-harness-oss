'use client'

/*
 * ★V8 ウェビナーを作る ①基本設定（Pencil j7PP04。入口 app/webinars/new/page.tsx。V8 のときだけここ）。
 * 下書きとして作り、「動画の設定へ」で編集の ②動画へ進む。
 * 口・確かめ・離れる前の確かめは app/webinars/new/new-v8.tsx と同じ（BEHAVIOR.md）。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { describeSaveFailure, webinarApi, type WebinarFolder } from '@/lib/api'
import { BackLink, WizardSteps } from './chrome'
import { BasicForm, BasicPreview, SLUG_PATTERN, type BasicValues } from './basic-form'

const FOLDERS_BLOCKED = 'フォルダを読み込めていないため、下書きを保存できません。フォルダをもう一度読み込んでください。'
const TITLE_EMPTY = 'ウェビナー名を入力してください'
const SLUG_BAD = '公開ページのURLは、半角の英小文字・数字・-（ハイフン）だけで入力してください'

function titleProblem(value: string): string | undefined {
  return value.trim() ? undefined : TITLE_EMPTY
}
/** 空欄は自動で付けるので問題なし。 */
function slugProblem(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase()
  return trimmed && !SLUG_PATTERN.test(trimmed) ? SLUG_BAD : undefined
}

export default function WebinarNewV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewInner />
    </Suspense>
  )
}

function NewInner() {
  usePageTitle('ウェビナー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const role = useStaffRole()
  const readOnly = role !== null && !canManageRole(role)
  const [values, setValues] = useState<BasicValues>({ title: '', slug: '', folderId: '', description: '', deliveryKind: 'on_demand' })
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; slug?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<false | 'list' | 'video'>(false)
  const savingRef = useRef(false)
  const folderRequest = useRef(0)

  const dirty = values.title.trim() !== '' || values.slug.trim() !== '' || values.description.trim() !== '' || values.deliveryKind !== 'on_demand' || values.folderId !== ''
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving !== false })

  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) { setFolders([]); setValues((prev) => ({ ...prev, folderId: '' })); setFolderState('ready'); return }
    const request = ++folderRequest.current
    setFolderState('loading')
    try {
      const response = await webinarApi.folders(selectedAccountId)
      if (request !== folderRequest.current) return
      if (!response.success || !Array.isArray(response.data)) throw new Error('folders_not_loaded')
      setFolders(response.data)
      setFolderState('ready')
      setError((previous) => (previous === FOLDERS_BLOCKED ? null : previous))
    } catch {
      if (request !== folderRequest.current) return
      setFolders([])
      setFolderState('error')
    }
  }, [selectedAccountId])
  useEffect(() => {
    void loadFolders()
    return () => { folderRequest.current += 1 }
  }, [loadFolders])

  const save = async (next: 'list' | 'video') => {
    if (savingRef.current || readOnly) return
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください'); return }
    if (folderState === 'error') { setError(FOLDERS_BLOCKED); return }
    const problems = { title: titleProblem(values.title), slug: slugProblem(values.slug) }
    if (problems.title || problems.slug) {
      setFieldErrors(problems)
      setError(problems.title ?? problems.slug ?? null)
      return
    }
    savingRef.current = true
    setSaving(next)
    setError(null)
    setFieldErrors({})
    const slug = values.slug.trim().toLowerCase()
    try {
      const created = await webinarApi.create({
        accountId: selectedAccountId,
        title: values.title.trim(),
        status: 'draft',
        slug: slug || `webinar-${Date.now()}`,
        videoPrefix: null,
        durationSeconds: 120 * 60,
        schedule: [],
        cta: null,
        folderId: values.folderId || null,
        deliveryKind: values.deliveryKind === 'scheduled' ? 'scheduled' : 'on_demand',
        viewingCondition: { kind: 'registered', label: '申込者向け' },
        publicDescription: values.description.trim() || undefined,
      })
      router.push(next === 'video' ? `/webinars/edit?id=${created.data.id}&pane=video` : '/webinars')
    } catch (cause) {
      setError(describeSaveFailure(cause))
      savingRef.current = false
      setSaving(false)
    }
  }

  const blocked = saving !== false || folderState !== 'ready'
  const blockedReason = folderState === 'error' ? 'フォルダを読み込めていないため保存できません' : undefined
  const accountName = selectedAccount?.displayName ?? selectedAccount?.name ?? '公式アカウント'

  return (
    <>
      <CreatePage
        boardId="j7PP04"
        title="ウェビナーを作る"
        identity={<BackLink />}
        steps={<WizardSteps current="basic" stateOf={(key) => (key === 'basic' ? 'current' : 'todo')} />}
        description="管理名と公開ページの基本、開催形式を決めます。保存しても、まだ誰にも公開されません。"
        status="下書き（まだ誰にも公開されません）"
        footerActions={<>
          <Button href="/webinars">キャンセル</Button>
          {readOnly ? null : <>
            <Button disabled={blocked} title={blockedReason} busy={saving === 'list'} onClick={() => void save('list')}>下書きを保存</Button>
            <Button variant="primary" disabled={blocked} title={blockedReason} busy={saving === 'video'} onClick={() => void save('video')}><ArrowRight size={15} aria-hidden="true" />動画の設定へ</Button>
          </>}
        </>}
        preview={<BasicPreview title={values.title} description={values.description} accountName={accountName} />}
      >
        {readOnly ? <Notice tone="info">閲覧のみで見ています。ウェビナーを作るのはオーナーか管理者です。</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <BasicForm
          idPrefix="webinar-new"
          values={values}
          onChange={(patch) => {
            setValues((prev) => ({ ...prev, ...patch }))
            if (patch.title !== undefined && fieldErrors.title !== undefined) setFieldErrors((prev) => ({ ...prev, title: titleProblem(patch.title ?? '') }))
            if (patch.slug !== undefined && fieldErrors.slug !== undefined) setFieldErrors((prev) => ({ ...prev, slug: slugProblem(patch.slug ?? '') }))
          }}
          onBlurTitle={() => setFieldErrors((prev) => ({ ...prev, title: titleProblem(values.title) }))}
          onBlurSlug={() => setFieldErrors((prev) => ({ ...prev, slug: slugProblem(values.slug) }))}
          folders={folders}
          folderState={folderState}
          onReloadFolders={() => void loadFolders()}
          audienceLabel="申込者向け"
          fieldErrors={fieldErrors}
          disabled={readOnly || saving !== false}
          readOnly={readOnly}
        />
      </CreatePage>
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
