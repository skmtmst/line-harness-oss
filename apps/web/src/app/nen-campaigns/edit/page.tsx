'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api, type NenColumn } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import CampaignEditor from './campaign-editor'
import { useAccount } from '@/contexts/account-context'

/*
 * 一覧は `api.nenCampaigns.columns`（`NenColumn`・ラクダ語）を読む。
 * 実API（`routes/nen-campaigns.ts` の columns 口）もモックもラクダ語で返す。
 * 以前はここだけヘビ語の別型で読んでいたため、下書きが常に空になり
 * 保存ボタンがずっと押せないままだった（#512 重大1）。
 */
type Column = Pick<NenColumn, 'id' | 'slug' | 'title' | 'introText' | 'publishedAt'>

/**
 * NENコラムに添える紹介文の編集。
 *
 * コラムの本文はEC側にある。ここで直せるのは「LINEで配るときに前に付ける
 * 一言」だけ。本文まで直せるように見せると、直したのに反映されない、
 * という食い違いになる。
 */
function NenColumnEditInner() {
  const params = useSearchParams()
  const campaignKey = params.get('key') ?? ''
  const { selectedAccountId } = useAccount()

  const [columns, setColumns] = useState<Column[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  /*
   * U102: カードごとの保存状態。保存の成否は「どの紹介文か」と一緒に
   * 持つ。ページ上端の共通帯に出すと、どのカードの話か見失う。
   */
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null)
  /*
   * #935 N-301: 紹介文を書きかけのまま離れると消えていた。
   * 保存済みの紹介文と違う間だけ、ブラウザ離脱・画面内リンク・戻る操作を止めて確認する。
   * hooksは分岐の前に置く（下の早期returnより先に呼ぶ）。
   */
  const dirty = columns.some((column) => (drafts[column.id] ?? '') !== (column.introText ?? ''))
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: savingId !== null })

  // ?key= が付いていれば、その配信そのものを編集する（設計 9-1-1）。
  // 付いていないときは、EC側のコラムに添える紹介文の一覧を出す。

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    if (!selectedAccountId) {
      setColumns([])
      setLoading(false)
      setError('LINEアカウントを選んでください')
      return
    }
    try {
      const res = await api.nenCampaigns.columns(selectedAccountId)
      if (res.success) {
        setColumns(res.data)
        const next: Record<string, string> = {}
        for (const c of res.data) next[c.id] = c.introText ?? ''
        setDrafts(next)
      }
    } catch {
      setError('読み込みに失敗しました。もう一度読み込んでください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (column: Column) => {
    if (!selectedAccountId) return
    setSavingId(column.id)
    setError('')
    setSaveError(null)
    setSavedId(null)
    try {
      const res = await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, drafts[column.id] ?? '')
      if (!res.success) {
        setSaveError({ id: column.id, message: '保存に失敗しました。時間をおいてもう一度お試しください。' })
        return
      }
      setSavedId(column.id)
      void load()
    } catch (e) {
      setSaveError({ id: column.id, message: e instanceof Error ? e.message : '保存に失敗しました。時間をおいてもう一度お試しください。' })
    } finally {
      setSavingId(null)
    }
  }

  if (campaignKey) return <CampaignEditor campaignKey={campaignKey} />

  return (
    <div>
      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/nen-campaigns" className="hover:underline">
          フォロー配信
        </Link>
        <span className="mx-1.5">›</span>
        <span>コラムの編集</span>
      </nav>

      <p className="text-ink-secondary mb-4 text-sm">
        コラムの本文はEC側にあります。ここで直せるのは、LINEで配るときに前に付ける一言だけです。
      </p>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : columns.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          コラムがまだありません。EC側で公開されると、ここに出ます。
        </div>
      ) : (
        <div className="max-w-3xl space-y-3">
          {columns.map((column) => (
            <div key={column.id} className="bg-canvas rounded-card border-hairline border p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-ink text-sm font-medium">{column.title}</p>
                <p className="text-ink-faint text-xs">
                  {column.publishedAt
                    ? new Date(column.publishedAt).toLocaleDateString('ja-JP')
                    : '未公開'}
                </p>
              </div>
              <textarea
                rows={3}
                value={drafts[column.id] ?? ''}
                onChange={(e) => {
                  setDrafts((prev) => ({ ...prev, [column.id]: e.target.value }))
                  // 書き直したら、このカードの保存済み・失敗の印は消す。
                  if (savedId === column.id) setSavedId(null)
                  if (saveError?.id === column.id) setSaveError(null)
                }}
                placeholder="例: 今週のコラムです。よろしければご覧ください。"
                aria-label={`${column.title}の紹介文`}
                maxLength={1500}
                className="border-hairline rounded-control w-full resize-y border px-3 py-2 text-sm"
              />
              {/*
                U102: 1つの保存ボタンのために72pxの StickyBar を
                カードごとに繰り返していた。状態と保存を1行の行操作へ
                まとめ、変更あり・保存中・保存済み・失敗をカード単位で
                識別できるようにする。
              */}
              <div className="mt-2 flex items-center justify-between gap-3">
                <p
                  className={`text-xs ${saveError?.id === column.id ? 'text-danger' : savedId === column.id ? 'text-success' : 'text-ink-faint'}`}
                  role={saveError?.id === column.id ? 'alert' : 'status'}
                >
                  {savingId === column.id
                    ? '保存しています…'
                    : saveError?.id === column.id
                      ? saveError.message
                      : savedId === column.id
                        ? 'この紹介文を保存しました'
                        : (drafts[column.id] ?? '') !== (column.introText ?? '')
                          ? '変更があります。保存するまで反映されません。'
                          : ''}
                </p>
                <button
                  onClick={() => save(column)}
                  disabled={savingId === column.id || (drafts[column.id] ?? '') === (column.introText ?? '')}
                  className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken shrink-0 border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {savingId === column.id ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* #935 N-301: 書きかけのまま離れるときの確認。 */}
      <ConfirmDialog
        open={leaveTarget !== null}
        title="入力した紹介文が保存されていません"
        description="このまま移動すると、入力した紹介文は保存されません。移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="書き続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

export default function NenColumnEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NenColumnEditInner />
    </Suspense>
  )
}
