'use client'

/*
 * ★V8 コメント演出（`Omqd4`）。
 * v7 の見た目は 1画素も変えない。編集画面で data-theme="v8" のときだけ、
 * コメントの段をこの部品で描く（V7 の CommentsTab は触らない）。
 *
 * 検証の決まり（上限・行の形）は CommentsTab と同じ。
 */
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { Th } from '@/components/shared/table'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { webinarApi, type WebinarSakuraComment } from '@/lib/api'

function validateImportRow(raw: unknown): WebinarSakuraComment | string {
  if (typeof raw !== 'object' || raw === null) return 'オブジェクトではありません'
  const rec = raw as Record<string, unknown>
  const atSeconds = Math.floor(Number(rec.atSeconds))
  if (!Number.isFinite(atSeconds) || atSeconds < -3600) return 'atSeconds が不正です (-3600〜)'
  const authorName = typeof rec.authorName === 'string' ? rec.authorName.trim() : ''
  if (!authorName) return 'authorName が空です'
  if (authorName.length > 50) return 'authorName が50字を超えています'
  const body = typeof rec.body === 'string' ? rec.body.trim() : ''
  if (!body) return 'body が空です'
  if (body.length > 500) return 'body が500字を超えています'
  return { atSeconds, authorName, body }
}

export default function CommentsV8({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarSakuraComment[]>([])
  const [loading, setLoading] = useState(true)
  const [importJson, setImportJson] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isErrorMessage, setIsErrorMessage] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    webinarApi
      .comments(webinarId)
      .then((res) => setComments(res.data))
      .finally(() => setLoading(false))
  }, [webinarId])

  const update = (i: number, patch: Partial<WebinarSakuraComment>) =>
    setComments((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    if (comments.length > WEBINAR_SAKURA_COMMENTS_MAX) {
      setIsErrorMessage(true)
      setMessage(`コメントは${WEBINAR_SAKURA_COMMENTS_MAX}件までです（いま${comments.length}件）。減らしてから保存してください。`)
      return
    }
    setSaving(true)
    try {
      const sorted = [...comments].sort((a, b) => a.atSeconds - b.atSeconds)
      const res = await webinarApi.saveComments(webinarId, sorted)
      setComments(sorted)
      setIsErrorMessage(false)
      setMessage(`${res.data.count}件保存しました`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`保存に失敗しました: ${webinarErrorText(err, '保存できませんでした。入力を見直してください。')}`)
    } finally {
      setSaving(false)
    }
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(importJson) as unknown
      if (!Array.isArray(parsed)) throw new Error('配列ではありません')
      const rows: WebinarSakuraComment[] = []
      for (let i = 0; i < parsed.length; i++) {
        const result = validateImportRow(parsed[i])
        if (typeof result === 'string') {
          throw new Error(`${i + 1}行目が不正です: ${result}`)
        }
        rows.push(result)
      }
      setComments(rows)
      setImportJson('')
      setShowImport(false)
      setIsErrorMessage(false)
      setMessage(`${rows.length}件読み込みました（保存ボタンで確定）`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`JSON が不正です: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Omqd4">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="コメント演出">
          <h2 className="text-ink text-base font-bold">コメント演出</h2>
          <p className="text-ink-faint mt-1 text-xs">
            動画の途中で出すコメントをあらかじめ入れます。{WEBINAR_SAKURA_COMMENTS_MAX}件まで。
          </p>
          {message ? <Notice tone={isErrorMessage ? 'danger' : 'info'}>{message}</Notice> : null}
          {loading ? (
            <p className="text-ink-faint py-6 text-center text-sm">読み込んでいます。</p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto rounded-control border border-hairline">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-canvas-sunken text-ink-secondary text-left text-xs">
                      <Th className="w-24">出す秒数</Th>
                      <Th className="w-36">名前</Th>
                      <Th>コメント</Th>
                      <Th>
                        <span className="sr-only">削除</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="divide-hairline divide-y">
                    {comments.map((c, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={c.atSeconds}
                            onChange={(e) => update(i, { atSeconds: Number(e.target.value) })}
                            aria-label={`${i + 1}行目の出す秒数`}
                            className="border-hairline bg-canvas text-ink w-20 rounded-control border px-2 py-1 text-xs tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={c.authorName}
                            onChange={(e) => update(i, { authorName: e.target.value })}
                            aria-label={`${i + 1}行目の名前`}
                            className="border-hairline bg-canvas text-ink w-full rounded-control border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={c.body}
                            onChange={(e) => update(i, { body: e.target.value })}
                            aria-label={`${i + 1}行目のコメント`}
                            className="border-hairline bg-canvas text-ink w-full rounded-control border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setComments((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`${c.authorName || '名前未入力'}のコメントを削除`}
                            className="text-danger px-1 text-base leading-none"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {comments.length === 0 ? (
                <p className="text-ink-faint mt-3 text-xs">まだコメントがありません。下の「追加」から足してください。</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setComments((prev) => [...prev, { atSeconds: 0, authorName: '', body: '' }])}
                >
                  ＋ 追加
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowImport((prev) => !prev)}
                  aria-expanded={showImport}
                >
                  JSONを貼り付ける
                </Button>
                <Button busy={saving} busyLabel="保存しています…" onClick={() => void save()}>
                  保存する
                </Button>
              </div>
              {showImport ? (
                <div className="mt-3 space-y-2">
                  <p className="text-ink-secondary text-xs">
                    形: {'[{"atSeconds":10,"authorName":"田中","body":"こんばんは"}]'}（{WEBINAR_SAKURA_COMMENTS_MAX}件まで）
                  </p>
                  <textarea
                    value={importJson}
                    onChange={(e) => setImportJson(e.target.value)}
                    rows={4}
                    aria-label="貼り付けるJSON"
                    className="border-hairline bg-canvas w-full rounded-control border p-2 font-mono text-xs"
                  />
                  <Button variant="secondary" onClick={doImport}>
                    読み込む
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
