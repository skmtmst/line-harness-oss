'use client'

import React, { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import { Th } from '@/components/shared/table'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { ApiError, webinarApi, type WebinarSakuraComment } from '@/lib/api'

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

export default function CommentsV8({ webinarId, onDirtyChange, registerSave }: { webinarId: string; onDirtyChange?: (dirty: boolean) => void; registerSave?: (save: (() => Promise<boolean>) | null) => void }) {
  const [comments, setComments] = useState<WebinarSakuraComment[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [baseline, setBaseline] = useState('[]')
  const generation = useRef(0)
  const locked = useRef(false)
  const [importJson, setImportJson] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isErrorMessage, setIsErrorMessage] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const request = ++generation.current
    setState('loading')
    setMessage(null)
    setComments([])
    setBaseline('[]')
    setImportJson('')
    void webinarApi.comments(webinarId).then((response) => {
      if (!Array.isArray(response.data)) throw new Error('invalid_comments')
      if (request !== generation.current) return
      setComments(response.data)
      setBaseline(JSON.stringify(response.data))
      setState('ready')
    }).catch((cause) => {
      if (request === generation.current) setState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
    })
    return () => { generation.current += 1 }
  }, [webinarId, attempt])

  const dirty = state === 'ready' && (JSON.stringify(comments) !== baseline || importJson.trim() !== '')
  useEffect(() => { onDirtyChange?.(dirty) }, [onDirtyChange, dirty])

  const update = (i: number, patch: Partial<WebinarSakuraComment>) =>
    setComments((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async (): Promise<boolean> => {
    if (state !== 'ready' || locked.current) return false
    setMessage(null)
    setIsErrorMessage(true)
    if (importJson.trim()) { setMessage('貼り付けたJSONを読み込んでから保存してください。'); return false }
    if (comments.length > WEBINAR_SAKURA_COMMENTS_MAX) {
      setMessage(`コメントは${WEBINAR_SAKURA_COMMENTS_MAX}件までです（いま${comments.length}件）。減らしてから保存してください。`)
      return false
    }
    const cleaned: WebinarSakuraComment[] = []
    for (let index = 0; index < comments.length; index += 1) {
      const row = validateImportRow(comments[index])
      if (typeof row === 'string') { setMessage(`${index + 1}行目を確認してください：${row}`); return false }
      cleaned.push(row)
    }
    const request = generation.current
    locked.current = true
    setSaving(true)
    try {
      const sorted = cleaned.sort((a, b) => a.atSeconds - b.atSeconds)
      const response = await webinarApi.saveComments(webinarId, sorted)
      if (request !== generation.current) return false
      setComments(sorted)
      setBaseline(JSON.stringify(sorted))
      setIsErrorMessage(false)
      setMessage(`${response.data.count}件保存しました`)
      return true
    } catch (cause) {
      if (request === generation.current) setMessage(`保存できませんでした。入力を残しました。${webinarErrorText(cause, '通信を確認して、もう一度保存してください。')}`)
      return false
    } finally {
      locked.current = false
      if (request === generation.current) setSaving(false)
    }
  }
  useEffect(() => { registerSave?.(save); return () => registerSave?.(null) }, [registerSave, comments, importJson, state, webinarId])

  const doImport = () => {
    try {
      const parsed = JSON.parse(importJson) as unknown
      if (!Array.isArray(parsed)) throw new Error('配列ではありません')
      if (parsed.length > WEBINAR_SAKURA_COMMENTS_MAX) throw new Error(`コメントは${WEBINAR_SAKURA_COMMENTS_MAX}件までです`)
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
    <div className="flex flex-col gap-4" data-design-node="Omqd4">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="コメント演出">
          <h2 className="text-ink text-base font-bold">コメント演出<HelpTip label="コメント演出の説明">動画の途中で出すコメントをあらかじめ入れます。{WEBINAR_SAKURA_COMMENTS_MAX}件まで。</HelpTip></h2>
          {message ? <Notice tone={isErrorMessage ? 'danger' : 'info'}>{message}</Notice> : null}
          {state === 'error' ? <Notice tone="info" action={<Button onClick={() => setAttempt((value) => value + 1)}>もう一度読み込む</Button>}>コメントを読み込めませんでした。保存前に読み直してください。</Notice> : state === 'denied' ? <Notice tone="info">コメントを編集する権限がありません。管理者に確認してください。</Notice> : state === 'loading' ? (
            <p className="text-ink-faint py-6 text-center text-sm">読み込んでいます。</p>
          ) : (
            <fieldset disabled={saving} className="min-w-0">
              <div className="mt-3 overflow-x-auto rounded-control border border-hairline">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="bg-canvas-sunken text-ink-secondary text-left text-xs">
                      <Th className="w-28">出す秒数</Th>
                      <Th className="w-36">名前</Th>
                      <Th>コメント</Th>
                      <Th className="w-12">
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
            </fieldset>
          )}
        </section>
      </div>
      <StickyBar status={dirty ? '保存していない変更があります' : undefined} actions={<><Button href="/webinars">キャンセル</Button><Button disabled={state !== 'ready' || saving} busy={saving} busyLabel="保存しています…" onClick={() => void save()}>保存する</Button></>} />
    </div>
  )
}
