'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { FriendField, FriendFieldType, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import FolderPanel from '@/components/shared/folder-panel'

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNFILED = '__unfiled__'

/** 種類の表示名。運用者は 'multi_select' ではなく「複数選択」で考える。 */
/**
 * 形式ごとの用途。設計（3-2-1）は「数値 — 体重など」のように、何に使うかを
 * 添えて選ばせている。形式名だけだと、選択（1つ）と選択（複数）の違いは
 * 分かっても、日付を何に使うのかが分からない。
 */
export const FIELD_TYPE_HINTS: Record<FriendFieldType, string> = {
  text: '短いテキスト',
  textarea: '長い文章',
  number: '体重など',
  date: '誕生日など',
  select: '決まった選択肢から選ぶ',
  multi_select: '決まった選択肢から複数選ぶ',
  checkbox: 'はい / いいえ',
  url: 'リンク',
  tel: '電話番号',
  email: 'メールアドレス',
}

export const FIELD_TYPE_LABELS: Record<FriendFieldType, string> = {
  text: '1行テキスト',
  textarea: '長いテキスト',
  number: '数値',
  date: '日付',
  select: '選択（1つ）',
  multi_select: '選択（複数）',
  checkbox: 'チェック',
  url: 'URL',
  tel: '電話番号',
  email: 'メールアドレス',
}

/**
 * 友だち情報欄の一覧。
 *
 * 差し込み名を目立たせているのは、この画面の主な用途が
 * 「テンプレートに何を書けばいいか調べる」ことだから。
 */
export default function FriendFieldList() {
  const [items, setItems] = useState<FriendField[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // フォルダは取れなくても一覧は出す。分けられないだけ。
      const [res, foldersRes] = await Promise.all([
        api.friendFields.list({ withUsage: true }),
        api.folders.list('friend_field').catch(() => null),
      ])
      if (res.success) setItems(res.data)
      if (foldersRes?.success) setFolders(foldersRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copyKey = async (field: FriendField) => {
    const snippet = `{{field.${field.fieldKey}}}`
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(field.id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // クリップボードが使えない環境もある。画面に出ているので手で写せる。
    }
  }

  const handleDelete = async (field: FriendField) => {
    const count = field.usageCount ?? 0
    const message =
      count > 0
        ? `「${field.name}」は ${count} 人に値が入っています。\n削除すると、その値も一緒に消えます。よろしいですか？`
        : `「${field.name}」を削除しますか？`
    if (!confirm(message)) return
    setError('')
    try {
      await api.friendFields.delete(field.id, { force: count > 0 })
      void load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('この項目は使用中のため削除できませんでした')
      } else {
        setError('削除に失敗しました')
      }
    }
  }

  const inFolder =
    folderId === ''
      ? items
      : folderId === UNFILED
        ? items.filter((f) => !f.folderId)
        : items.filter((f) => f.folderId === folderId)
  const visible =
    query.trim() === ''
      ? inFolder
      : inFolder.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
  const folderLabel = folderId === '' ? 'すべて' : (folders.find((f) => f.id === folderId)?.name ?? '未分類')

  return (
    <div>
      {/*
        ここで作った項目がどこへ効くかを、一覧の上に1行で置く。設計でも
        同じ帯がある。名前だけ見ても、何のために作る場所なのかが分からない。
      */}
      <div className="bg-accent-soft rounded-card mb-4 flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <span className="text-ink-secondary">ここで定義した項目は</span>
        <span className="text-accent font-medium">回答フォームの登録先</span>
        <span className="text-ink-faint">→</span>
        <span className="text-accent font-medium">友だち詳細のタブ</span>
        <span className="text-ink-faint">→</span>
        <span className="text-accent font-medium">テンプレートの差し込み</span>
        <span className="text-ink-secondary">として使われます。</span>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FolderPanel
          total={`${items.length} 項目`}
          activeId={folderId}
          onSelect={setFolderId}
          rows={[
            { id: '', label: 'すべて', count: items.length },
            ...folders.map((f) => ({
              id: f.id,
              label: f.name,
              count: items.filter((i) => i.folderId === f.id).length,
            })),
            { id: UNFILED, label: '未分類', count: items.filter((i) => !i.folderId).length },
          ]}
        />

        <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <p className="text-ink text-base font-bold">{folderLabel}</p>
          <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs">
            {visible.length} 項目
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="項目名で検索"
            aria-label="項目名で検索"
            className="border-hairline rounded-control focus:ring-accent border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
          />
          <Link
            href="/tags/fields/new"
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
          >
            ＋ 項目を追加
          </Link>
        </div>
      </div>

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                {/* 列は設計の絵の並び。差し込みの形は項目名の下に添える。
                    列を1つ使うほどではないが、この画面で調べる人は多い。 */}
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  友だち情報欄名
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  種別
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  既定値
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  入力済み
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  表示
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-ink-faint px-4 py-8 text-center text-sm">
                    読み込み中...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-ink-faint px-4 py-8 text-center text-sm">
                    {items.length === 0
                      ? '項目がまだありません。「項目を追加」から作ってください。'
                      : 'この絞り込みに当てはまる項目はありません。'}
                  </td>
                </tr>
              ) : (
                visible.map((field) => (
                  <tr key={field.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3">
                      <p className="text-ink text-sm font-medium">{field.name}</p>
                      {/* 差し込みの形は名前の下に添える。押すと写せる。 */}
                      <button
                        onClick={() => copyKey(field)}
                        title="クリックでコピー"
                        className="text-ink-faint hover:text-ink-secondary mt-0.5 font-mono text-[11px]"
                      >
                        {copied === field.id ? 'コピーしました' : `{{field.${field.fieldKey}}}`}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px]">
                        {FIELD_TYPE_LABELS[field.type] ?? field.type}
                      </span>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {field.defaultValue || <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums">
                      {field.usageCount ?? 0}
                      <span className="text-ink-faint ml-0.5 text-xs">人</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {field.isStarred ? (
                          <span className="text-accent inline-flex items-center gap-1 text-xs">
                            ★ 一覧に表示
                          </span>
                        ) : (
                          <span className="text-ink-faint text-xs">—</span>
                        )}
                        {field.isPersonal && (
                          <span
                            className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-[11px]"
                            title="オーナー・管理者だけが見られます。開いた記録が残ります。"
                          >
                            個人情報
                          </span>
                        )}
                        {field.ecIsMaster && (
                          <span
                            className="bg-info-bg text-info rounded-pill px-2 py-0.5 text-[11px]"
                            title="EC側の値が正です。管理画面からは変更できません。"
                          >
                            EC側が正
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(field)}
                        className="hover:bg-danger-bg text-danger rounded-md px-2.5 py-1 text-xs font-medium"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-ink-faint mt-3 text-xs leading-relaxed">
        差し込み名と種類は、作ったあとに変えられません。
        種類を変えると入っている値の意味が変わり、差し込み名を変えるとテンプレートの差し込みが空になるためです。
        変えたいときは新しい項目を作ってください。
      </p>
        </div>
      </div>
    </div>
  )
}
