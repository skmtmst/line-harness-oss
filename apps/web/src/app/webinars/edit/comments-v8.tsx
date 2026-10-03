'use client'

/*
 * ★V8-B ウェビナーのコメント演出（板 `Omqd4`）の中身。
 *
 * v7 の編集画面（`page.tsx` の `CommentsTab`）と同じ口（読む・足す・
 * まとめて貼り付ける・消す・保存する）。v7 側は触らない。
 * 右に視聴画面での見え方を出す。
 */
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { webinarApi, type WebinarSakuraComment } from '@/lib/api'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import styles from './comments-v8.module.css'

const inputClass =
  'w-full border border-hairline rounded-control px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-action'

export default function CommentsView({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarSakuraComment[]>([])
  const [loading, setLoading] = useState(true)
  const [importJson, setImportJson] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isErrorMessage, setIsErrorMessage] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    webinarApi
      .comments(webinarId)
      .then((res) => { if (!cancelled) setComments(res.data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [webinarId])

  const update = (i: number, patch: Partial<WebinarSakuraComment>) =>
    setComments((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    /* 上限を超えたまま送るとサーバーの 400 で初めて気づく。手前で止める。 */
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

  // サーバー側 (PUT /api/webinars/:id/comments) と同じ検証条件を事前に適用する。
  // ここで弾いておかないと、不正な行が NaN / "undefined" のまま
  // 「◯件読み込みました」と成功表示されてしまい、保存時のサーバー 400 で
  // 初めて気づく上にどの行が悪いか分からない。
  function validateImportRow(raw: unknown): WebinarSakuraComment | string {
    if (typeof raw !== 'object' || raw === null) return 'オブジェクトではありません'
    const rec = raw as Record<string, unknown>
    const atSeconds = Math.floor(Number(rec.atSeconds))
    // 負の atSeconds = 開始前 (待機ルーム) コメント。サーバーと同じく -3600 まで許容
    if (!Number.isFinite(atSeconds) || atSeconds < -3600) return 'atSeconds が不正です (-3600〜)'
    const authorName = typeof rec.authorName === 'string' ? rec.authorName.trim() : ''
    if (!authorName) return 'authorName が空です'
    if (authorName.length > 50) return 'authorName が50字を超えています'
    const body = typeof rec.body === 'string' ? rec.body.trim() : ''
    if (!body) return 'body が空です'
    if (body.length > 500) return 'body が500字を超えています'
    return { atSeconds, authorName, body }
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
      setImportOpen(false)
      setIsErrorMessage(false)
      setMessage(`${rows.length}件読み込みました（保存ボタンで確定）`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`JSON が不正です: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (loading) {
    return <div className="text-ink-faint text-sm">読み込み中...</div>
  }

  const preview = [...comments].sort((a, b) => a.atSeconds - b.atSeconds).slice(-2)

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        {message && (
          <Notice tone={isErrorMessage ? 'danger' : 'info'}>
            {message}
          </Notice>
        )}
        <section className={styles.card} aria-label="流すコメント（演出）">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>流すコメント（演出）</h2>
              <p className={styles.cardDesc}>動画の決まった秒に、用意したコメントを流します。マイナスの秒は開始前（待機ルーム）。最大{WEBINAR_SAKURA_COMMENTS_MAX}件・いま{comments.length}件</p>
            </div>
            <Button variant="primary" disabled={saving} onClick={() => void save()} busy={saving} busyLabel="保存中…">保存する</Button>
          </div>
          <DataTable>
            <TableHeadRow>
              <Th>秒数</Th>
              <Th>名前</Th>
              <Th>本文</Th>
              <Th align="right"><span className="sr-only">削除</span></Th>
            </TableHeadRow>
            {comments.map((c, i) => (
              <Tr key={i}>
                <Td>
                  <input
                    type="number"
                    value={c.atSeconds}
                    onChange={(e) => update(i, { atSeconds: Number(e.target.value) })}
                    className={`${inputClass} w-20`}
                    aria-label={`${i + 1}件目の秒数`}
                  />
                </Td>
                <Td>
                  <input
                    value={c.authorName}
                    onChange={(e) => update(i, { authorName: e.target.value })}
                    className={inputClass}
                    aria-label={`${i + 1}件目の名前`}
                  />
                </Td>
                <Td>
                  <input
                    value={c.body}
                    onChange={(e) => update(i, { body: e.target.value })}
                    className={inputClass}
                    aria-label={`${i + 1}件目の本文`}
                  />
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    onClick={() => setComments((prev) => prev.filter((_, j) => j !== i))}
                    className="text-danger hover:text-danger"
                    aria-label={`${c.authorName || '名前未入力'}のコメントを削除`}
                  >
                    削除
                  </button>
                </Td>
              </Tr>
            ))}
          </DataTable>
          <div className={styles.addRow}>
            <button type="button" className={styles.addLink} onClick={() => setComments((prev) => [...prev, { atSeconds: 0, authorName: '', body: '' }])}>
              ＋ コメントを足す
            </button>
            <button type="button" className={styles.addLink} onClick={() => setImportOpen((open) => !open)}>
              まとめて貼り付ける（JSON）
            </button>
          </div>
          {importOpen ? (
            <div className={styles.importBox}>
              <p className={styles.cardDesc}>
                JSON 一括インポート（形式: {'[{"atSeconds":10,"authorName":"田中","body":"こんばんは"}]'}、{WEBINAR_SAKURA_COMMENTS_MAX}件まで）
              </p>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={4}
                className="w-full rounded-control border border-hairline p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-action"
                aria-label="貼り付けるコメントのJSON"
              />
              <Button onClick={doImport} className="mt-1">
                読み込む
              </Button>
            </div>
          ) : null}
        </section>
        <StickyBar actions={(
          <Button variant="primary" disabled={saving} onClick={() => void save()} busy={saving} busyLabel="保存中…">保存する</Button>
        )} />
      </div>
      <div>
        <h2 className={styles.previewTitle}>視聴画面での見え方</h2>
        <div className={styles.previewScreen} aria-hidden="true">
          {preview.map((c) => (
            <p key={`${c.atSeconds}-${c.authorName}-${c.body}`} className={styles.previewLine}>
              {c.authorName}：{c.body}
            </p>
          ))}
        </div>
        <p className={styles.cardDesc}>本物の視聴者コメントは「分析」で見られます</p>
      </div>
    </div>
  )
}
