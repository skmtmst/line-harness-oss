'use client'

/*
 * ★V8「友だち情報欄を作る」（Pencil `w9zY5`）の入口。
 *
 * 読み込み・重複確認・冪等キー・保存の動きは今の入口（app/tags/new-field-page-v8.tsx）と同じ。
 * 中身は src/v8 の FieldEditor。受け付ける URL：`/tags/fields/new`・`?back=<戻り先>`。
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, describeSaveFailure } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import { notifyToast } from '@/components/shared/toast'
import { folderById, folderCreator } from '@/components/shared/folder-select'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import FieldEditor, { type FieldEditorValues } from './field-editor'

export default function FieldNew() {
  const router = useRouter()
  const params = useSearchParams()
  const back = params.get('back')
  const { selectedAccountId } = useAccount()

  const [folders, setFolders] = useState<Folder[]>([])
  // その場でフォルダを作れるのは、左の列の「フォルダを追加」と同じ人（閲覧のみは作れない）。
  const staffRole = useStaffRole()
  const canCreateFolder = staffRole === null || canManageRole(staffRole)
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  /* R514: 既存項目が取れていないのに空一覧として扱わない。 */
  const [existing, setExisting] = useState<FriendField[]>([])
  const [existingState, setExistingState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloading, setReloading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadFolders = useCallback(async () => {
    setReloading(true)
    try {
      const res = await api.folders.list('friend_field')
      if (!res.success) throw new Error(res.error)
      setFolders(res.data)
      setFoldersState('ready')
    } catch {
      setFoldersState('error')
    } finally {
      setReloading(false)
    }
  }, [])

  const loadExisting = useCallback(async () => {
    const account = selectedAccountId
    if (!account) {
      setExistingState('error')
      return
    }
    setReloading(true)
    try {
      const res = await api.friendFields.list(account)
      if (!res.success) throw new Error(res.error)
      setExisting(res.data)
      setExistingState('ready')
    } catch {
      setExistingState('error')
    } finally {
      setReloading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void loadFolders() }, [loadFolders])
  useEffect(() => { void loadExisting() }, [loadExisting])

  const save = async (values: FieldEditorValues, requestKey: string) => {
    if (saving) return
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    setSaving(true)
    setError('')
    try {
      const res = await api.friendFields.create(selectedAccountId, {
        name: values.name,
        fieldKey: values.fieldKey,
        type: values.type,
        folderId: values.folderId || null,
        options: values.options,
        // R139: 複数選択は選択肢名の配列で渡す。文字列では422になる。
        defaultValue: values.defaultValue,
        isPersonal: values.isPersonal,
        isStarred: values.isStarred,
        ecIsMaster: values.ecIsMaster,
        ecFieldPath: values.ecIsMaster ? values.ecFieldPath : null,
        // R515: 同じ作成のやり直しは同じ要求キーで送り、二重に作らない。
      }, requestKey)
      if (!res.success) throw new Error(res.error)
      notifyToast(`「${values.name.trim()}」を作りました`)
      router.push(back ?? `/tags?tab=fields&highlight=${res.data.id}`)
    } catch (reason) {
      setError(describeSaveFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldEditor
      mode="create"
      folders={folders}
      foldersState={foldersState}
      foldersReloading={reloading}
      onRetryFolders={() => void loadFolders()}
      onCreateFolder={canCreateFolder
        ? folderCreator((name, color) => api.folders.create({ kind: 'friend_field', name, color }), folderById, (created) => setFolders((current) => [...current, created]))
        : undefined}
      siblings={existing}
      siblingsReady={existingState === 'ready'}
      saving={saving}
      error={error}
      backHref={back ?? '/tags?tab=fields'}
      /* 既存項目の取得失敗は隠さず、その場で再試行する。入力は残す（R514）。 */
      notices={existingState === 'error' ? (
        <ListState
          kind="error"
          title="既存の項目を読み込めませんでした"
          description="重複を確認できないため、読み直すまで保存できません。入力内容はそのままです。"
          onRetry={() => void loadExisting()}
          retrying={reloading}
        />
      ) : null}
      onCancel={() => router.push(back ?? '/tags?tab=fields')}
      onSubmit={(values, requestKey) => void save(values, requestKey)}
    />
  )
}
