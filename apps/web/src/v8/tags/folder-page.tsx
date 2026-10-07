'use client'

/*
 * ★V8 友だち属性「フォルダを追加」（Pencil `IjVpM`）。タグの一覧（src/v8/tags/list）の上に窓を重ねる。
 *
 * 読み込み・保存・削除・クエリの切り替え（古い応答を捨てる）は今の画面（app/tags/folders/new/page.tsx）と同じ。
 * 受け付ける URL：`/tags/folders/new`（タグのフォルダを追加）・`?id=<フォルダ>`（直す・削除）・
 * `?kind=friend_field`（友だち情報欄のフォルダを追加。今の「作成する場所」の切り替えの代わり）。
 * 色は絵の9色（名前つき。色だけで見分けない）。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FolderCheck, FolderPlus, Trash2 } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import TagsList from './list'
import styles from './create.module.css'

/* 絵の9色。保存する値は色コード、読み上げと見出しは名前。既定は緑（基調色）。 */
export const TAG_FOLDER_COLORS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#EF4444', name: '赤' },
  { value: '#F97316', name: 'オレンジ' },
  { value: '#F59E0B', name: '黄' },
  { value: '#06C755', name: '緑' },
  { value: '#3B82F6', name: '青' },
  { value: '#06B6D4', name: '水色' },
  { value: '#7C3AED', name: '紫' },
  { value: '#EC4899', name: 'ピンク' },
  { value: '#6B7280', name: 'グレー' },
]
const DEFAULT_COLOR = TAG_FOLDER_COLORS[3].value

type RequestKey = { editId: string | null; generation: number }
const sameRequest = (a: RequestKey, b: RequestKey) => a.editId === b.editId && a.generation === b.generation

/** 保存の失敗を、運用者が次に取る行動の言葉で返す（API の文言をそのまま出さない）。 */
export function folderSaveError(status?: number): string {
  switch (status) {
    case 400: return '入力内容を確認してください。フォルダ名は60文字以内で入力してください。'
    case 403: return 'フォルダを変更する権限がありません。管理者に確認してください。'
    case 404: return 'フォルダが見つかりません。一覧へ戻って最新の状態を確認してください。'
    case 409: return 'ほかの担当者が先に変更しました。最新の内容を読み直してください。'
    default: return '保存できませんでした。時間を置いて、もう一度お試しください。'
  }
}

function folderDeleteError(status?: number): string {
  switch (status) {
    case 400: return '削除できませんでした。フォルダの状態を確認して、もう一度お試しください。'
    case 403: return 'フォルダを削除する権限がありません。管理者に確認してください。'
    case 404: return '削除しようとしたフォルダが見つかりません。一覧へ戻って最新の状態を確認してください。'
    case 409: return 'ほかの担当者が先に変更したため、削除できませんでした。最新の内容を読み直してください。'
    default: return '削除できませんでした。時間を置いて、もう一度お試しください。'
  }
}

export default function TagFolderPageV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <TagFolderPage />
    </Suspense>
  )
}

function TagFolderPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const editId = params.get('id')
  const scope: 'tag' | 'friend_field' = !editId && params.get('kind') === 'friend_field' ? 'friend_field' : 'tag'
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [folderAccountId, setFolderAccountId] = useState<string | null>(selectedAccountId)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const activeRef = useRef<RequestKey>({ editId, generation: 0 })
  /* 直すとき、ready になるまで名前も色も本物ではない。空のまま保存して元の名前を消さない。 */
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error' | 'forbidden'>(editId ? 'loading' : 'ready')

  const close = () => router.push(scope === 'tag' ? '/tags' : '/tags?tab=fields')

  const loadFolder = () => {
    const request = { editId, generation: activeRef.current.generation + 1 }
    activeRef.current = request
    setError('')
    setSaving(false)
    if (!editId) {
      setName('')
      setColor(DEFAULT_COLOR)
      setFolderAccountId(selectedAccountId)
      setLoadState('ready')
      return
    }
    setName('')
    setColor(DEFAULT_COLOR)
    setLoadState('loading')
    void api.tagGroups.list(selectedAccountId)
      .then((result) => {
        if (!sameRequest(activeRef.current, request)) return
        if (!result.success) { setLoadState('error'); return }
        const group = result.data.find((item) => item.id === editId)
        if (!group) { setLoadState('error'); return }
        setName(group.name)
        setColor(group.color ?? DEFAULT_COLOR)
        setFolderAccountId(group.accountId)
        setLoadState('ready')
      })
      .catch((reason: unknown) => {
        if (!sameRequest(activeRef.current, request)) return
        const status = (reason as { status?: number } | null)?.status
        setLoadState(status === 403 ? 'forbidden' : 'error')
      })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadFolder, [editId, selectedAccountId])

  const save = async () => {
    if (!name.trim() || saving || loadState !== 'ready') return
    const request = { ...activeRef.current }
    setSaving(true)
    setError('')
    try {
      if (scope === 'tag') {
        const result = editId
          ? await api.tagGroups.update(editId, { name: name.trim(), color, accountId: folderAccountId })
          : await api.tagGroups.create({ name: name.trim(), color, accountId: selectedAccountId })
        if (!result.success) throw new Error('save_failed')
      } else {
        const result = await api.folders.create({ kind: 'friend_field', name: name.trim(), color })
        if (!result.success) throw new Error('save_failed')
      }
      if (!sameRequest(activeRef.current, request)) return
      close()
    } catch (reason) {
      if (!sameRequest(activeRef.current, request)) return
      setError(folderSaveError(reason instanceof ApiError ? reason.status : undefined))
    } finally {
      if (sameRequest(activeRef.current, request)) setSaving(false)
    }
  }

  const remove = async () => {
    if (!editId || saving) return
    const request = { ...activeRef.current }
    setSaving(true)
    setError('')
    try {
      const result = await api.tagGroups.delete(editId, folderAccountId)
      if (!result.success) throw new Error('delete_failed')
      if (!sameRequest(activeRef.current, request)) return
      router.push('/tags')
    } catch (reason) {
      if (!sameRequest(activeRef.current, request)) return
      setDeleteOpen(false)
      setError(folderDeleteError(reason instanceof ApiError ? reason.status : undefined))
    } finally {
      if (sameRequest(activeRef.current, request)) setSaving(false)
    }
  }

  /* 止まっている理由は押せない見た目だけにせず、ボタンの title と本文に出す。 */
  const blockedReason =
    loadState === 'loading' ? '読み込んでいます'
      : loadState === 'error' ? '読み込めませんでした'
        : loadState === 'forbidden' ? '操作する権限がありません'
          : !name.trim() ? 'フォルダ名を入力すると保存できます'
            : null
  const title = editId ? 'フォルダを直す' : scope === 'friend_field' ? '友だち情報欄のフォルダを追加する' : 'フォルダを追加する'

  return (
    <>
      <TagsList accountId={selectedAccountId} />
      <Dialog
        open
        designNode="IjVpM"
        designWidth={560}
        designTop={300}
        designHeaderPadding="24px 24px 0"
        title={title}
        busy={saving}
        error={error || undefined}
        onCancel={close}
        footer={(
          <div className={styles.dialogFooter}>
            {editId ? (
              <Button type="button" variant="danger" disabled={saving} onClick={() => setDeleteOpen(true)}>
                <Trash2 size={15} aria-hidden="true" />削除する
              </Button>
            ) : null}
            <span className={styles.dialogFooterEnd}>
              <Button type="button" disabled={saving} onClick={close}>キャンセル</Button>
              <Button type="button" variant="primary" disabled={saving || blockedReason !== null} title={blockedReason ?? undefined} onClick={() => void save()} busy={saving}>
                {editId ? <FolderCheck size={15} aria-hidden="true" /> : <FolderPlus size={15} aria-hidden="true" />}
                {editId ? 'フォルダを保存する' : 'フォルダを作る'}
              </Button>
            </span>
          </div>
        )}
      >
        <div className={styles.dialogBody}>
          {loadState === 'forbidden' ? <p className={styles.fieldNote}>見る権限がありません</p> : null}
          {loadState === 'loading' ? <p className={styles.fieldNote}>読み込んでいます</p> : null}
          {loadState === 'error' ? (
            <div className={styles.inlineRetry}>
              <p className={styles.fieldError}>読み込めませんでした</p>
              <Button type="button" variant="text" onClick={loadFolder}>再読み込み</Button>
            </div>
          ) : null}
          <label className={styles.field}>
            <span className={styles.label}>フォルダ名</span>
            <input
              className={styles.input}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例：購入"
              maxLength={60}
              disabled={loadState !== 'ready'}
            />
          </label>
          <div className={styles.colorField} role="group" aria-labelledby="folder-color">
            <span className={styles.labelStrong} id="folder-color">色</span>
            <span className={styles.colorRow}>
              {TAG_FOLDER_COLORS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-label={item.name}
                  title={item.name}
                  aria-pressed={color.toLowerCase() === item.value.toLowerCase()}
                  disabled={loadState !== 'ready'}
                  className={styles.colorSwatch}
                  style={{ backgroundColor: item.value }}
                  onClick={() => setColor(item.value)}
                />
              ))}
            </span>
            <p className={styles.keyNote}>{`${TAG_FOLDER_COLORS.map((item) => item.name).join('・')}（色だけに頼らず名前でも見分けます）`}</p>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        title={`「${name}」を削除しますか？`}
        description="フォルダだけを削除します。中にあるタグは削除されず、未分類へ戻ります。"
        confirmLabel="このフォルダを削除する"
        destructive
        busy={saving}
        onCancel={() => { if (!saving) setDeleteOpen(false) }}
        onConfirm={() => void remove()}
      />
    </>
  )
}
