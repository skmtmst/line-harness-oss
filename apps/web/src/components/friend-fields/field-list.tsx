'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { FriendField, FriendFieldType } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friendFields.list({ withUsage: true })
      if (res.success) setItems(res.data)
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-secondary text-sm">
          友だちごとに持たせる項目です。フォームの回答をここに入れると、
          友だち詳細に出て、テンプレートに差し込めるようになります。
        </p>
        <Link
          href="/tags/fields/new"
          className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
        >
          ＋ 項目を追加
        </Link>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  項目名
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  テンプレートに書く形
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  種類
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  入っている人
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  取り扱い
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
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-ink-faint px-4 py-8 text-center text-sm">
                    項目がまだありません。「項目を追加」から作ってください。
                  </td>
                </tr>
              ) : (
                items.map((field) => (
                  <tr key={field.id} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm font-medium">
                      {field.isStarred && (
                        <span className="text-warning mr-1" title="よく使う項目">
                          ★
                        </span>
                      )}
                      {field.name}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => copyKey(field)}
                        title="クリックでコピー"
                        className="bg-canvas-sunken text-ink-secondary rounded-control px-2 py-1 font-mono text-xs hover:bg-hairline"
                      >
                        {copied === field.id ? 'コピーしました' : `{{field.${field.fieldKey}}}`}
                      </button>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {FIELD_TYPE_LABELS[field.type] ?? field.type}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums">
                      {field.usageCount ?? 0}
                      <span className="text-ink-faint ml-0.5 text-xs">人</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
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
                        {field.source === 'form' && (
                          <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px]">
                            フォームから
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
  )
}
