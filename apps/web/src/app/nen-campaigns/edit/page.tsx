'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, type NenColumn } from '@/lib/api'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import CampaignEditor from './campaign-editor'
import CampaignEditorV8 from './campaign-editor-v8'
import { useAccount } from '@/contexts/account-context'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { formatDay } from '@/lib/format'
import Button from '@/components/shared/button'

/*
 * 一覧は `api.nenCampaigns.columns`（`NenColumn`・ラクダ語）を読む。
 * 実API（`routes/nen-campaigns.ts` の columns 口）もモックもラクダ語で返す。
 * 以前はここだけヘビ語の別型で読んでいたため、下書きが常に空になり
 * 保存ボタンがずっと押せないままだった（#512 重大1）。
 */
type Column = Pick<NenColumn, 'id' | 'slug' | 'title' | 'introText' | 'publishedAt' | 'updatedAt'>

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
   * M507残差: 409で止めるだけでは元受入「最新を見せる」に届かない。
   * 読み直した最新の紹介文を、下書きを置き換えず同カード内に
   * 読み取り専用で別表示するためのもの。保存成功・読み直しで消す。
   * 書き直しても消さない（比べながら直す助けに残す）。
   */
  const [latestIntro, setLatestIntro] = useState<{ id: string; text: string } | null>(null)
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
    setLatestIntro(null)
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
      // M507: 開いたときの版を添える。ほかの人が先に保存していたら409で止まる。
      const res = await api.nenCampaigns.updateColumnMessage(selectedAccountId, column.id, drafts[column.id] ?? '', column.updatedAt)
      if (!res.success) {
        setSaveError({ id: column.id, message: '保存に失敗しました。時間をおいてもう一度お試しください。' })
        return
      }
      // 版を成功応答の新しい版へ進める。他のカードの入力は残したままにする。
      setColumns((current) => current.map((item) => item.id === column.id
        ? { ...item, introText: drafts[column.id] ?? item.introText, updatedAt: res.data?.updatedAt ?? item.updatedAt }
        : item))
      setSavedId(column.id)
      // M507残差: 保存を通したら比べる相手は要らない。比較表示を消す。
      setLatestIntro(null)
    } catch (e) {
      // M507: 競合時は最新の紹介文を読み直し、入力は残したまま比べながら
      // 保存し直せるようにする。
      if (e instanceof ApiError && e.status === 409 && e.code === 'VERSION_CONFLICT') {
        const latest = (e.data as { latest?: { introText?: string; updatedAt?: string } } | null)?.latest
        if (latest) {
          setColumns((current) => current.map((item) => item.id === column.id
            ? { ...item, introText: latest.introText ?? item.introText, updatedAt: latest.updatedAt ?? item.updatedAt }
            : item))
          // M507残差: 下書きは置き換えない。最新の紹介文は同カードに別表示する。
          setLatestIntro({ id: column.id, text: latest.introText ?? '' })
        } else {
          setLatestIntro(null)
          void load()
        }
        setSaveError({ id: column.id, message: 'ほかの人が先に保存しました。最新の内容を確認してから、もう一度保存してください。入力した内容はそのまま残っています。' })
        return
      }
      setSaveError({ id: column.id, message: e instanceof Error ? e.message : '保存に失敗しました。時間をおいてもう一度お試しください。' })
    } finally {
      setSavingId(null)
    }
  }

  /*
   * ★V8-B：data-theme="v8" のときだけ新しい配信編集画面（w5pwG）へ切り替える。
   * v7 の見た目はそのまま。取得・保存の決めごとは変えない。
   */
  const theme = useAdminTheme()
  if (campaignKey) return theme === 'v8' ? <CampaignEditorV8 campaignKey={campaignKey} /> : <CampaignEditor campaignKey={campaignKey} />

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <nav className="text-ink-faint text-xs">
        <Link href="/nen-campaigns" className="hover:underline">
          フォロー配信
        </Link>
        <span className="mx-1.5">›</span>
        <span>コラムの編集</span>
      </nav>

      <p className="text-ink-secondary text-sm">
        コラムの本文はEC側にあります。ここで直せるのは、LINEで配るときに前に付ける一言だけです。
      </p>

      {error && (
        <Notice tone="danger" message={error} className="mb-4" />
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
        <div className="flex max-w-3xl flex-col gap-4">
          {columns.map((column) => (
            <div key={column.id} className="bg-canvas rounded-card border-hairline border p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-ink text-sm font-medium">{column.title}</p>
                <p className="text-ink-faint text-xs">
                  {column.publishedAt
                    ? formatDay(column.publishedAt)
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
                M507残差: 下書きは置き換えず、読み直した最新の紹介文を
                同カード内に読み取り専用で別表示する。箱の中に箱は作らず
                余白と文字の段（見出し12・本文14）だけで区切る。
              */}
              {latestIntro?.id === column.id && (
                <div className="mt-2">
                  <p className="text-ink-faint text-xs">ほかの人が保存した最新の紹介文</p>
                  <p className="text-ink-secondary mt-1 text-sm whitespace-pre-wrap">
                    {latestIntro.text === '' ? '（空になっています）' : latestIntro.text}
                  </p>
                </div>
              )}
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
                <Button variant="secondary" className="text-ink-secondary shrink-0 px-3 py-1.5 font-medium h-auto whitespace-normal" onClick={() => save(column)} disabled={savingId === column.id || (drafts[column.id] ?? '') === (column.introText ?? '')}>
                  {savingId === column.id ? '保存中...' : '保存する'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* #935 N-301: 書きかけのまま離れるときの確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した紹介文" onConfirm={confirmLeave} onCancel={cancelLeave} />
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
