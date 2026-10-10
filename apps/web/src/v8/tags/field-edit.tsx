'use client'

/*
 * ★V8「友だち情報欄を編集」（Pencil `w9zY5` の編集の形）の入口。
 *
 * 読み込み・版の衝突（R517）・共通項目の保護・保存の動きは今の入口（app/tags/edit-field-page-v8.tsx）と同じ。
 * 中身は src/v8 の FieldEditor。受け付ける URL：`/tags/fields/edit?id=<項目>`。
 */
import Notice from '@/components/shared/notice'
import { SaveConflictBand, SaveConflictCompareDialog, useSaveConflict } from '@/components/shared/save-conflict'
import { notifySaved } from '@/components/shared/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { isSameFieldContent, type SentFieldContent } from './field-model'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { folderById, folderCreator } from '@/components/shared/folder-select'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import FieldEditor, { type FieldEditorValues } from './field-editor'

export default function FieldEdit() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()

  const [field, setField] = useState<FriendField | null>(null)
  const [siblings, setSiblings] = useState<FriendField[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  // その場でフォルダを作れるのは、左の列の「フォルダを追加」と同じ人（閲覧のみは作れない）。
  const staffRole = useStaffRole()
  const canCreateFolder = staffRole === null || canManageRole(staffRole)
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloading, setFoldersReloading] = useState(false)
  /* R517: 版の衝突で返ってきた最新の内容。 */
  const [conflictName, setConflictName] = useState<string | null>(null)
  const latestConflict = useRef<FriendField | null>(null)
  const context = useRef({ account: selectedAccountId, id })
  context.current = { account: selectedAccountId, id }
  const draftValues = useRef<FieldEditorValues | null>(null)
  const trackDraft = useCallback((values: FieldEditorValues) => { draftValues.current = values }, [])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [editorResetKey, setEditorResetKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) return
    setFoldersReloading(true)
    try {
      const res = await api.folders.list('friend_field')
      if (!res.success) throw new Error(res.error)
      setFolders(res.data)
      setFoldersState('ready')
    } catch {
      // R516: 失敗を隠さず、所属の選択欄の場所で再試行する。
      setFoldersState('error')
    } finally {
      setFoldersReloading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    setField(null)
    setNotFound(false)
    setConflictName(null)
    latestConflict.current = null
    collision.clear()
    void Promise.all([
      api.friendFields.list(selectedAccountId, { withUsage: true }),
      api.folders.list('friend_field').catch(() => null),
    ]).then(([list, folderResult]) => {
      if (cancelled) return
      if (folderResult?.success) {
        setFolders(folderResult.data)
        setFoldersState('ready')
      } else {
        setFoldersState('error')
      }
      if (!list.success) throw new Error(list.error)
      setSiblings(list.data)
      const found = list.data.find((item) => item.id === id) ?? null
      if (!found) { setNotFound(true); return }
      setField(found)
      setEditorResetKey((key) => key + 1)
    }).catch((reason) => {
      if (cancelled) return
      if (reason instanceof ApiError && reason.status === 404) {
        setError('')
        setNotFound(true)
      } else {
        setError(reason instanceof ApiError ? reason.message : '項目を読み込めませんでした')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, reloadKey, selectedAccountId])

  /*
   * R517: 版の衝突で返ってきたとき、最新を取り直して送った内容と比べる。
   * 同じなら応答消失前の保存が成功しているので保存済みと案内し、
   * 違うなら他人の変更として差分と取り込み口を示す。入力は残す。
   */
  const handleVersionConflict = async (sent: SentFieldContent) => {
    const account = selectedAccountId
    if (!account || !field) return
    try {
      const res = await api.friendFields.list(account, { withUsage: true })
      if (context.current.account !== account || context.current.id !== field.id) return
      if (!res.success) throw new Error(res.error)
      const latest = res.data.find((item) => item.id === field.id) ?? null
      if (!latest) {
        setError('項目が見つかりません。一覧から選び直してください。')
        setNotFound(true)
        return
      }
      setSiblings(res.data)
      if (isSameFieldContent(sent, latest)) {
        setField(latest)
        setConflictName(null)
        notifySaved('保存されています。入力した内容は最新の保存内容と同じです。', { actionLabel: '一覧で確認する', onAction: () => router.push(`/tags?tab=fields&highlight=${field.id}`) })
        setError('')
      } else {
        // 入力と読んだ版を守り、取り込みを選んだときだけ進める。
        latestConflict.current = latest
        collision.mark()
        setConflictName(latest.name)
            setError('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
      }
    } catch {
      setError('最新の内容を確認できませんでした。接続を確かめて、もう一度保存してください。')
    }
  }

  const save = async (values: FieldEditorValues) => {
    if (saving || !field || !selectedAccountId) return
    const sent: SentFieldContent = {
      name: values.name,
      folderId: values.folderId || null,
      options: values.options,
      defaultValue: values.defaultValue,
      isPersonal: values.isPersonal,
      isStarred: values.isStarred,
      ecIsMaster: values.ecIsMaster,
      ecFieldPath: values.ecIsMaster ? values.ecFieldPath : null,
    }
    setSaving(true)
    setError('')
    setConflictName(null)
    try {
      const res = await api.friendFields.update(field.id, selectedAccountId, {
        ...sent,
        // 読んだ版と違えばサーバーが409で止める。他の人の先勝ちを黙って潰さない。
        version: field.version,
      })
      if (!res.success) throw new Error(res.error)
      setField(res.data)
      setSiblings((rows) => rows.map((row) => row.id === res.data.id ? res.data : row))
      setConflictName(null)
      collision.clear()
      notifySaved()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409
        && (reason as { code?: string }).code === 'VERSION_CONFLICT') {
        await handleVersionConflict(sent)
      } else {
        setError(reason instanceof ApiError ? reason.message : '項目を保存できませんでした')
      }
    } finally {
      setSaving(false)
    }
  }

  /* R517: 最新の内容を入力へ取り込む（エディタを初期値へ戻す）。 */
  const applyLatest = () => {
    if (latestConflict.current) setField(latestConflict.current)
    setConflictName(null)
    setError('')
    collision.clear()
    setEditorResetKey((key) => key + 1)
  }

  const collision = useSaveConflict<FriendField>({ fetchLatest: async () => latestConflict.current, reload: applyLatest })
  const comparison = collision.latest ? Object.entries({ 名前: ['name', collision.latest.name], 選択肢: ['options', collision.latest.options], 既定値: ['defaultValue', collision.latest.defaultValue], フォルダ: ['folderId', collision.latest.folderId], 個人情報: ['isPersonal', collision.latest.isPersonal], お気に入り: ['isStarred', collision.latest.isStarred], ECを正とする: ['ecIsMaster', collision.latest.ecIsMaster], ECの項目: ['ecFieldPath', collision.latest.ecFieldPath] }).flatMap(([label, [key, latest]]) => {
    const current = draftValues.current?.[key as keyof FieldEditorValues] ?? null
    return JSON.stringify(current) === JSON.stringify(latest ?? null) ? [] : [{ text: `${label}：編集中 ${JSON.stringify(current)} → 最新 ${JSON.stringify(latest ?? null)}` }]
  }) : null

  if (loading) return <ListState kind="loading" />
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する友だち情報欄が指定されていません"
        description="一覧から編集する項目を選び直してください。"
        backHref="/tags?tab=fields"
        backLabel="友だち情報欄の一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return <ListState kind="empty" title="上部でLINE公式アカウントを選んでください" />
  if (notFound || (!error && !field)) {
    return (
      <TargetMissing
        kind="not-found"
        title="この項目は見つかりません"
        description="削除されたか、別のLINEアカウントの項目です。一覧から選び直せます。"
        accountName={selectedAccount?.name}
        backHref="/tags?tab=fields"
        backLabel="友だち情報欄の一覧へ戻る"
      />
    )
  }
  if (!field) {
    return (
      <TargetMissing
        kind="error"
        title="項目を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  if (staffRole !== null && !canManageRole(staffRole)) return <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />

  const notices = (
    <>
      {/* ほかの担当者の変更と入力を比べて決める。入力は残す（R517）。 */}
      {conflictName !== null ? (
        <SaveConflictBand title={`ほかの人が先に友だち情報欄「${conflictName}」を保存しました`} compareBusy={collision.compareBusy} onCompare={collision.compare} onReload={collision.reloadLatest} />
      ) : null}
    </>
  )

  return (
    <>
    <FieldEditor
      key={editorResetKey}
      mode="edit"
      field={field}
      locked={field.isInherited === true}
      folders={folders}
      foldersState={foldersState}
      foldersReloading={foldersReloading}
      onRetryFolders={() => void loadFolders()}
      onCreateFolder={canCreateFolder
        ? folderCreator((name, color) => api.folders.create({ kind: 'friend_field', name, color }), folderById, (created) => setFolders((current) => [...current, created]))
        : undefined}
      siblings={siblings}
      siblingsReady
      saving={saving}
      error={error}
      notices={notices}
      onDraftChange={trackDraft}
      backHref="/tags?tab=fields"
      onCancel={() => router.push('/tags?tab=fields')}
      onSubmit={(values) => void save(values)}
    />
    <SaveConflictCompareDialog open={collision.compareOpen} busy={collision.compareBusy} error={collision.compareError} lines={comparison} onReload={collision.reloadLatest} onCancel={collision.closeCompare} />
    </>
  )
}
