'use client'

/*
 * ★V8「友だち情報欄を編集」（Pencil `EhEXu`）の入口。
 *
 * 読み込み・版の衝突（R517）・共通項目の保護・保存の動きは
 * v7（fields/edit/page.tsx）と同じ。中身の部品だけ `FieldEditorV8`。
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { isSameFieldContent, type SentFieldContent } from './fields/edit/field-edit-conflict'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import FieldEditorV8, { type FieldEditorValues } from './field-editor-v8'

export default function EditFieldPageV8() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()

  const [field, setField] = useState<FriendField | null>(null)
  const [siblings, setSiblings] = useState<FriendField[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloading, setFoldersReloading] = useState(false)
  /* R517: 版の衝突で返ってきた最新の内容。 */
  const [conflictName, setConflictName] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
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
    setJustSaved(false)
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
        setJustSaved(true)
        setError('')
      } else {
        // 版だけ進め、入力は残す。保存し直すと新しい版で送られる。
        setField(latest)
        setConflictName(latest.name)
        setJustSaved(false)
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
    setJustSaved(false)
    try {
      const res = await api.friendFields.update(field.id, selectedAccountId, {
        ...sent,
        // 読んだ版と違えばサーバーが409で止める。他の人の先勝ちを黙って潰さない。
        version: field.version,
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/tags?tab=fields&highlight=${res.data.id}`)
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
    setConflictName(null)
    setEditorResetKey((key) => key + 1)
  }

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
  if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p>
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

  return (
    <div>
      {/* R517: 応答消失後の再試行で、送った内容が保存済みと分かった。 */}
      {justSaved ? (
        <Notice
          tone="success"
          className="mb-4"
          action={<Button type="button" onClick={() => router.push(`/tags?tab=fields&highlight=${field.id}`)}>一覧で確認する</Button>}
        >
          保存されています。入力した内容は最新の保存内容と同じです。
        </Notice>
      ) : null}
      {/* R517: ほかの担当者の変更と入力を比べて決める。入力は残す。 */}
      {conflictName !== null ? (
        <Notice
          tone="warn"
          className="mb-4"
          action={<Button type="button" onClick={applyLatest}>最新の内容を取り込む</Button>}
        >
          最新の保存内容は「{conflictName}」です。入力内容はそのまま残しています。
          入力のまま保存し直すか、最新の内容を取り込んでください。
        </Notice>
      ) : null}
      <FieldEditorV8
        key={editorResetKey}
        mode="edit"
        field={field}
        locked={field.isInherited === true}
        folders={folders}
        foldersState={foldersState}
        foldersReloading={foldersReloading}
        onRetryFolders={() => void loadFolders()}
        siblings={siblings}
        siblingsReady
        saving={saving}
        error={error}
        onCancel={() => router.push('/tags?tab=fields')}
        onSubmit={(values) => void save(values)}
      />
    </div>
  )
}
