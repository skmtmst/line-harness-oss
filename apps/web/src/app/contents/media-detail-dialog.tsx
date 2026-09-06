'use client'

import { useEffect, useRef, useState } from 'react'
import type { MediaDeleteImpact, MediaDeleteImpactReference, MediaItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from './media-button'
import Dialog from '@/components/shared/dialog'
import { checkedAtText, referenceKindText, referenceNameText } from './media-delete-impact'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—（未取得）'
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' }).format(date)
}

function mediaKind(item: MediaItem): string {
  if (item.kind === 'image') return '画像'
  if (item.kind === 'video') return '動画'
  if (item.kind === 'audio') return '音声'
  return 'PDF'
}

export default function MediaDetailDialog({
  item,
  accountId,
  folderName,
  onClose,
  onOpenReplacement,
}: {
  item: MediaItem | null
  accountId: string | null
  folderName: string
  onClose: () => void
  onOpenReplacement: (item: MediaItem) => void
}) {
  const requestRef = useRef(0)
  const [impact, setImpact] = useState<MediaDeleteImpact | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!item || !accountId) return
    const request = requestRef.current + 1
    requestRef.current = request
    setImpact(null)
    setPhase('loading')
    void api.media.deleteImpact(item.id, accountId)
      .then((response) => {
        if (requestRef.current !== request) return
        if (!response.success) throw new Error('impact_failed')
        setImpact(response.data)
        setPhase('ready')
      })
      .catch(() => {
        if (requestRef.current === request) setPhase('error')
      })
    return () => {
      requestRef.current += 1
    }
  }, [accountId, item])

  return (
    <Dialog
      open={item !== null}
      title={item?.filename ?? ''}
      designNode="voJtX"
      onCancel={onClose}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" onClick={onClose}>閉じる</Button>
          {item && impact && impact.usageCount > 0 ? (
            <Button type="button" variant="primary" onClick={() => onOpenReplacement(item)}>
              別のメディアに差し替える
            </Button>
          ) : null}
        </div>
      )}
    >
      {item ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3 md:col-span-2">
            <div className="bg-canvas-sunken rounded-card flex min-h-56 items-center justify-center overflow-hidden">
              {item.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.filename} className="max-h-72 max-w-full object-contain" />
              ) : item.kind === 'video' ? (
                <video src={item.url} controls className="max-h-72 max-w-full" />
              ) : item.kind === 'audio' ? (
                <audio src={item.url} controls />
              ) : (
                <a href={item.url} target="_blank" rel="noreferrer" className="text-action text-sm font-semibold">PDFを開く</a>
              )}
            </div>

            <section className="border-hairline rounded-card border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-ink text-sm font-bold">このメディア自体を差し替える</h3>
                  <p className="text-ink-faint mt-1 text-xs">名前を保ったまま新しい版を追加するAPIは、まだ接続されていません。</p>
                </div>
                <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-1 text-xs font-semibold">利用不可</span>
              </div>
              <p className="bg-warning-bg text-warning mt-3 rounded-control p-3 text-xs leading-5">
                いま使える「別のメディアに差し替える」は、使用先を既存の別メディアへまとめて付け替える操作です。
              </p>
            </section>
          </div>

          <aside className="space-y-3">
            <section className="border-hairline rounded-card border p-4">
              <h3 className="text-ink text-sm font-bold">ファイルのこと</h3>
              <dl className="mt-3 space-y-2 text-xs">
                {[
                  ['種類', mediaKind(item)],
                  ['大きさ', item.width != null && item.height != null ? `${item.width} × ${item.height} px` : item.durationMs != null ? `${Math.round(item.durationMs / 1000)}秒` : '—（未取得）'],
                  ['容量', formatSize(item.sizeBytes)],
                  ['入れた日', formatDate(item.createdAt)],
                  ['入れた人', item.uploadedBy || '—（未取得）'],
                  ['フォルダ', folderName],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <dt className="text-ink-faint">{label}</dt>
                    <dd className="text-ink text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <a href={item.url} download={item.filename} className="text-action mt-4 inline-flex text-xs font-semibold">ダウンロード</a>
            </section>

            <section className="border-hairline rounded-card border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-ink text-sm font-bold">使われている場所</h3>
                <span className="text-action text-xs font-bold">{impact ? `${impact.usageCount}か所` : '—'}</span>
              </div>
              {phase === 'loading' ? (
                <p className="text-ink-faint mt-3 text-xs">使われている場所を確認しています…</p>
              ) : phase === 'error' ? (
                <p className="text-danger mt-3 text-xs" role="alert">使われている場所を確認できませんでした。</p>
              ) : impact && impact.references.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {impact.references.map((reference: MediaDeleteImpactReference, index) => (
                    <li key={`${reference.kind}-${index}`} className="border-hairline rounded-control border p-2 text-xs">
                      <p className="text-ink font-semibold">{referenceKindText(reference.kind)}「{referenceNameText(reference)}」</p>
                      {reference.href ? <a href={reference.href} className="text-action mt-1 inline-flex font-semibold">ここを開く</a> : <p className="text-ink-faint mt-1">この画面からは開けません</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-faint mt-3 text-xs">どこでも使われていません。</p>
              )}
              {impact ? <p className="text-ink-faint mt-3 text-xs">{checkedAtText(impact.checkedAt)} 時点で確認</p> : null}
            </section>
          </aside>
        </div>
      ) : null}
    </Dialog>
  )
}
