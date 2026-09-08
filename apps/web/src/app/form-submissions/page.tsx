'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import { api, type FormDeleteImpact } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import type { FormLayout } from '@line-crm/shared'
import { hasStoredDestination, summarizeFormDestinations } from './form-destination-summary'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import { TableHeadRow, Th } from '@/components/shared/table'
import './form-submissions.css'

interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

interface Form {
  id: string
  name: string
  description: string | null
  fields: Array<{ name: string; label: string; type?: string }>
  layout: FormLayout
  onSubmitTagId: string | null
  isActive: boolean
  status: 'active' | 'archived'
  revision: number
  submitCount?: number
  weeklySubmitCount?: number
  folderId?: string | null
  destinationSummary?: { friendFieldCount: number; tagCount: number }
  createdAt: string
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
}

interface FormFolder {
  id: string
  name: string
  formCount: number
}

type FormListResponse = Form[] | {
  items: Form[]
  total: number
  page: number
  limit: number
}

type FormFilter = 'all' | 'published' | 'draft' | 'stored'

export default function FormSubmissionsPage() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [folders, setFolders] = useState<FormFolder[]>([])
  const [formTotal, setFormTotal] = useState(0)
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [formFilter, setFormFilter] = useState<FormFilter>('all')
  const [editingForm, setEditingForm] = useState<Form | null>(null)
  const [editingName, setEditingName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<FormDeleteImpact | null>(null)
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const formRequest = useRef(0)

  const loadForms = useCallback(async () => {
    const request = ++formRequest.current
    if (!selectedAccountId) {
      setForms([])
      setFolders([])
      setFormTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const account = `account_id=${encodeURIComponent(selectedAccountId)}`
      const [res, folderRes] = await Promise.all([
        fetchApi<{ success: boolean; data: FormListResponse }>(`/api/forms?${account}&with_list_summary=1`),
        fetchApi<{ success: boolean; data: FormFolder[] }>(`/api/folders?kind=form&${account}`),
      ])
      if (!res.success || !folderRes.success) throw new Error('load_failed')
      if (request !== formRequest.current) return
      const items = Array.isArray(res.data) ? res.data : res.data.items
      setForms(items)
      setFolders(folderRes.data)
      setFormTotal(Array.isArray(res.data) ? items.length : res.data.total)
    } catch {
      if (request !== formRequest.current) return
      setLoadError('回答フォームを読み込めませんでした。')
      setForms([])
      setFolders([])
      setFormTotal(0)
    } finally {
      if (request === formRequest.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadForms()
  }, [loadForms])

  const createDraft = async () => {
    if (creating || !selectedAccountId) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.forms.createDraft(selectedAccountId)
      if (!res.success) throw new Error(res.error)
      router.push(`/form-submissions/edit?id=${encodeURIComponent(res.data.id)}&tab=basic`)
    } catch {
      setCreateError('フォームの下書きを作れませんでした。もう一度お試しください。')
    } finally {
      setCreating(false)
    }
  }

  const openRename = (form: Form) => {
    setEditingForm(form)
    setEditingName(displayFormName(form.name))
    setRenameError('')
  }

  const saveName = async () => {
    if (!editingForm || !editingName.trim() || savingName || !selectedAccountId) return
    const name = displayFormName(editingName)
    setSavingName(true)
    setRenameError('')
    try {
      const res = await fetchApi<{ success: boolean; data: Form }>(`/api/forms/${editingForm.id}?account_id=${encodeURIComponent(selectedAccountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      if (!res.success) throw new Error('rename_failed')
      setForms((current) => current.map((form) => (
        form.id === editingForm.id ? { ...form, name } : form
      )))
      setEditingForm(null)
    } catch {
      setRenameError('フォーム名を変更できませんでした。もう一度お試しください。')
    } finally {
      setSavingName(false)
    }
  }

  const openDelete = async (form: Form) => {
    setDeleteTarget(form)
    setDeleteImpact(null)
    setDeleteImpactLoading(true)
    setDeleteError('')
    if (!selectedAccountId) {
      setDeleteImpactLoading(false)
      setDeleteError('LINE公式アカウントを選んでください。')
      return
    }
    try {
      const result = await api.forms.deleteImpact(form.id, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      setDeleteImpact(result.data)
    } catch {
      setDeleteError('アーカイブしたときの影響を確認できませんでした。もう一度開き直してください。')
    } finally {
      setDeleteImpactLoading(false)
    }
  }

  const removeForm = async () => {
    if (!deleteTarget || !deleteImpact || deleting || stopping || !selectedAccountId) return
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError('')
    try {
      const result = deleteImpact.canDelete
        ? await api.forms.remove(targetId, selectedAccountId, deleteImpact.revision)
        : await api.forms.archive(targetId, selectedAccountId, deleteImpact.revision)
      if (!result.success) throw new Error('delete_failed')
      setForms((current) => current.filter((form) => form.id !== targetId))
      setDeleteTarget(null)
    } catch {
      setDeleteError('この回答フォームをアーカイブできませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const stopAccepting = async () => {
    if (!deleteTarget || stopping || deleting || !selectedAccountId) return
    setStopping(true)
    setDeleteError('')
    try {
      const result = await api.forms.update(deleteTarget.id, selectedAccountId, { isActive: false })
      if (!result.success) throw new Error(result.error)
      setForms((current) => current.map((form) => (
        form.id === deleteTarget.id ? { ...form, isActive: false } : form
      )))
      setDeleteTarget(null)
      setDeleteImpact(null)
    } catch {
      setDeleteError('回答の受付を止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopping(false)
    }
  }

  const sortedForms = useMemo(() => sortFormsByLatestAnswer(forms), [forms])
  const filteredForms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortedForms.filter((form) => {
      if (activeFolderId === 'unfiled' && form.folderId) return false
      if (activeFolderId !== 'all' && activeFolderId !== 'unfiled' && form.folderId !== activeFolderId) return false
      if (formFilter === 'published' && !form.isActive) return false
      if (formFilter === 'draft' && form.isActive) return false
      if (formFilter === 'stored' && !hasStoredDestination(form.layout, form.onSubmitTagId)) return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.fields.some((field) => field.label.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [activeFolderId, formFilter, query, sortedForms])

  return (
    <div data-design-node="EMBIK">
      <div data-design="Bar" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={createDraft} disabled={creating}>
            {creating ? '下書きを作成中' : 'フォームを作る'}
          </Button>
        </div>
        {forms[0] ? (
          <Button href={`/form-submissions/responses?id=${encodeURIComponent(forms[0].id)}`}>
            集まった回答を見る
          </Button>
        ) : (
          <Button disabled>集まった回答を見る</Button>
        )}
      </div>

      <div style={FOLDER_RAIL_STYLE} className="grid items-start gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          total={loading || loadError ? '— 件' : `${formTotal} 件`}
          activeId={activeFolderId}
          onSelect={setActiveFolderId}
          addFolderDisabled
          addFolderTitle="フォームのフォルダ保存先は未接続です"
          rows={[
            { id: 'all', label: 'すべて', count: loading || loadError ? 0 : formTotal },
            ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.formCount })),
            { id: 'unfiled', label: '未分類', count: loading || loadError ? 0 : Math.max(0, formTotal - folders.reduce((sum, folder) => sum + folder.formCount, 0)) },
          ]}
        />

        <section className="min-w-0">
          <div className="border-hairline rounded-card mb-3 flex flex-wrap items-center gap-2 border bg-white p-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="フォーム名・質問文で検索"
              aria-label="フォーム名・質問文で検索"
              className="border-hairline rounded-control focus:ring-accent min-w-60 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <span className="text-xs text-ink-faint">回答が多い順</span>
            <Select
              aria-label="表示件数"
              size="page-size"
              value="20"
              options={[{ value: '20', label: '20件表示' }]}
              onChange={() => undefined}
            />
          </div>

          <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-faint">保存した検索</span>
            {([
              ['all', 'すべて'],
              ['published', '公開中'],
              ['draft', '下書き'],
              ['stored', '情報欄に保存している'],
            ] as Array<[FormFilter, string]>).map(([value, label]) => {
              const active = formFilter === value
              return (
                <label key={value} className={`rounded-pill cursor-pointer border px-3 py-1 text-xs ${active ? 'border-accent bg-accent-soft text-ink' : 'border-hairline bg-white text-ink-secondary'}`}>
                  <input type="radio" name="form-filter" value={value} checked={active} onChange={() => setFormFilter(value)} className="sr-only" />
                  {label}
                </label>
              )
            })}
          </div>

          {createError && <p className="mb-3 text-sm text-danger">{createError}</p>}
          {accountLoading ? (
          <ListState kind="loading" title="LINE公式アカウントを確認しています" />
        ) : !selectedAccountId ? (
          <ListState
            kind="empty"
            title="LINE公式アカウントを選んでください"
            description="上のアカウント切替から、回答フォームを使う公式アカウントを選びます。"
          />
        ) : loading ? (
          <ListState
            kind="loading"
            title="読み込んでいます"
            description="このまま少しお待ちください。"
          />
        ) : loadError ? (
          <ListState
            kind="error"
            title="表示できませんでした"
            description="再読み込みしても直らないときは、エラー報告へお知らせください。"
            onRetry={() => void loadForms()}
          />
        ) : forms.length === 0 ? (
          <div className="space-y-3">
            <p className="rounded-control bg-accent-soft px-3 py-2 text-xs text-ink-secondary">
              フォームがまだ1つも無いときの見え方です。「フォームを作る」から最初の1つを作ると、ここに一覧が並びます。
            </p>
            <ListState
              kind="empty"
              title="まだフォームがありません"
              description="最初の1つを作ると、集まった回答もここから見られます。"
              action={(
                <Button variant="primary" onClick={createDraft} disabled={creating}>
                  {creating ? '下書きを作成中' : 'フォームを作る'}
                </Button>
              )}
            />
          </div>
        ) : (
          filteredForms.length === 0 ? (
            <ListState
              kind="empty"
              title="条件に合うフォームはありません"
              description="検索語や絞り込み条件を変えてください。"
            />
          ) : (
          <div className="border-hairline rounded-card overflow-hidden border bg-white">
            <table className="w-full table-fixed text-sm">
              <thead>
                <TableHeadRow>
                  <Th className="w-1/3">フォーム</Th>
                  <Th className="w-28">状態</Th>
                  <Th>回答の保存先</Th>
                  <Th className="w-24" align="right">回答数</Th>
                  <Th className="w-24">更新</Th>
                  <Th className="w-28" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
            {filteredForms.map((form) => {
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              const normalizedName = displayFormName(form.name)
              const destinationSummary = summarizeFormDestinations(form.layout, form.onSubmitTagId)
              const listDestinationSummary = form.destinationSummary
                ? [
                    form.destinationSummary.friendFieldCount > 0 ? `友だち情報欄${form.destinationSummary.friendFieldCount}` : '',
                    form.destinationSummary.tagCount > 0 ? `タグ${form.destinationSummary.tagCount}` : '',
                  ].filter(Boolean).join('・') || '—'
                : destinationSummary.label
              return (
                <tr key={form.id} className="text-ink-secondary">
                  <td className="px-3 py-2.5">
                    <Link href={`/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic`} className="block truncate font-semibold text-ink hover:underline" title={normalizedName}>{normalizedName}</Link>
                    <span className="block truncate text-xs text-ink-faint">{form.description || `${form.fields.length}ブロック`}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{form.isActive ? '公開中' : '下書き'}</td>
                  <td className="truncate px-3 py-2.5 text-xs" title={listDestinationSummary}>{listDestinationSummary}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    <span className="block">{displayCount ? `${displayCount.toLocaleString('ja-JP')}件` : '—'}</span>
                    {form.weeklySubmitCount ? <span className="block text-ink-faint">今週 {form.weeklySubmitCount.toLocaleString('ja-JP')}件</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{new Date(form.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    <Link href={`/form-submissions/responses?id=${encodeURIComponent(form.id)}`} className="text-accent hover:underline">回答</Link>
                    <button type="button" onClick={() => openRename(form)} className="ml-2 text-accent hover:underline">編集</button>
                    <button type="button" onClick={() => void openDelete(form)} className="ml-2 text-danger hover:underline" aria-label={`${normalizedName}を削除`} title="回答フォームを削除">削除</button>
                  </td>
                </tr>
              )
            })}
              </tbody>
            </table>
          </div>
          )
        )}
          {!loading && !loadError && forms.length > 0 ? (
            <p className="mt-3 text-xs text-ink-faint">
              {formTotal.toLocaleString('ja-JP')}件中 1〜{filteredForms.length.toLocaleString('ja-JP')}件を表示
            </p>
          ) : null}
        </section>
      </div>

      {/* Rename dialog */}
      {editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => !savingName && setEditingForm(null)}
            aria-label="名前変更を閉じる"
          />
          <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">フォーム名を変更</h3>
            <p className="mt-1 text-xs text-gray-400">
              回答データやURLは変わりませんが、回答者に表示されるフォーム名も変わります。
            </p>
            <p className="mt-1 text-xs text-gray-400">推奨：サービス名｜目的（対象・導線）</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
              <span className="rounded bg-gray-100 px-2 py-1">質問 {editingForm.fields.length}項目</span>
              {editingForm.usedByAccounts.map((account) => (
                <span key={account.id} className="rounded bg-gray-100 px-2 py-1">
                  {account.name}
                </span>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">フォーム名</span>
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName()
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            {renameError && <p className="mt-2 text-xs text-red-500">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingForm(null)}
                disabled={savingName}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={!editingName.trim() || savingName}
                className="rounded-lg bg-accent-deep px-4 py-2 text-sm font-medium text-white hover:brightness-92 disabled:opacity-50"
              >
                {savingName ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="gBp2J"
        title={deleteTarget
          ? `「${displayFormName(deleteTarget.name)}」を${deleteImpact?.canDelete ? '削除' : 'アーカイブ'}しますか？`
          : '回答フォームをアーカイブしますか？'}
        description={deleteImpact?.canDelete
          ? '未公開で回答も利用先もないため、フォームを完全に削除できます。この操作は元に戻せません。'
          : '公開中・回答あり・利用中のフォームは削除せず、回答と利用先を残してアーカイブします。公開URLは開けなくなります。'}
        confirmLabel={deleteImpact?.canDelete ? '削除する' : 'アーカイブする'}
        destructive={deleteImpact?.canDelete ?? false}
        busy={deleting || stopping || deleteImpactLoading}
        error={deleteError}
        onCancel={() => {
          if (deleting || stopping) return
          setDeleteTarget(null)
          setDeleteImpact(null)
          setDeleteError('')
        }}
        onConfirm={deleteImpact && deleteImpact.recommendedAction !== 'none'
          ? () => void removeForm()
          : undefined}
      >
        {deleteImpactLoading ? (
          <p className="text-ink-faint text-sm">公開状態・回答数・利用中の場所を確認しています。</p>
        ) : deleteImpact ? (
          <div className="space-y-3 text-sm">
            <dl className="bg-canvas-sunken grid grid-cols-2 gap-2 rounded-control p-3">
              <div><dt className="text-ink-faint text-xs">公開状態</dt><dd className="text-ink mt-1 font-medium">{deleteImpact.form.isActive ? '公開中' : '受付停止中'}</dd></div>
              <div><dt className="text-ink-faint text-xs">集まった回答</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.submissionCount.toLocaleString('ja-JP')}件</dd></div>
              <div><dt className="text-ink-faint text-xs">利用中の場所</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.referenceCount.toLocaleString('ja-JP')}か所</dd></div>
              <div><dt className="text-ink-faint text-xs">開かれた回数</dt><dd className="text-ink mt-1 font-medium tabular-nums">{deleteImpact.openCount.toLocaleString('ja-JP')}回</dd></div>
            </dl>
            {deleteImpact.answerUrl && (
              <div>
                <p className="text-ink-faint text-xs">開けなくなる公開URL</p>
                <p className="text-ink mt-1 break-all text-xs">{deleteImpact.answerUrl}</p>
              </div>
            )}
            {deleteImpact.references.length > 0 && (
              <div>
                <p className="text-ink-faint text-xs">先に差し替える利用先</p>
                <ul className="text-ink-secondary mt-1 space-y-1 text-xs">
                  {deleteImpact.references.map((reference, index) => (
                    <li key={`${reference.kind}-${reference.href ?? index}`}>
                      ・{reference.name ?? '名前を確認できない利用先'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!deleteImpact.canDelete && deleteImpact.form.isActive && (
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink text-xs font-medium">受付だけ止める（おすすめ）</p>
                <p className="text-ink-faint mt-1 text-xs">一覧と回答を残したまま、新しい回答だけを止めます。</p>
                <Button className="mt-3" onClick={() => void stopAccepting()} disabled={stopping || deleting}>
                  {stopping ? '停止中' : '受付だけ止める'}
                </Button>
              </div>
            )}
            {deleteImpact.submissionCount > 0 && (
              <Button href={`/form-submissions/responses?id=${encodeURIComponent(deleteImpact.form.id)}`}>
                回答をCSVで書き出す画面へ
              </Button>
            )}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
