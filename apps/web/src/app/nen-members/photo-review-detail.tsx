'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import StickyBar from '@/components/shared/sticky-bar'
import type { PhotoAssetStatus, PhotoDerivatives } from '@/lib/api'
import { formatPhotoReceivedAt } from './photo-review-time'
import { safePhotoSrc } from './photo-src'
import { photoPetDisplayName } from '@/components/shared/photo-display-name'
import { text } from './photo-text'

const numberOrDash = (value: unknown) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ja-JP') : '—'

export function PhotoReviewDetail({
  photo, position, total, loading, loadKind, reviewing, notice, assetStatus, derivatives, assetsFailed, onReloadAssets, assetProcessing,
  onBack, onMove, onApprove, onReturn, onProcessReviewAsset, onDownloadOriginal,
}: {
  photo: Record<string, unknown> | null
  position: number
  total: number
  loading: boolean
  loadKind: 'ready' | 'empty' | 'error' | 'forbidden'
  reviewing: boolean
  notice: string
  assetStatus: PhotoAssetStatus | null
  derivatives: PhotoDerivatives | null
  assetsFailed: boolean
  onReloadAssets: () => void
  assetProcessing: boolean
  onBack: () => void
  onMove: (direction: -1 | 1) => void
  onApprove: () => void
  onReturn: () => void
  onProcessReviewAsset: () => void
  onDownloadOriginal: (code: string) => Promise<void>
}) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadCode, setDownloadCode] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  if (loading) return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="loading" title="写真を読み込んでいます" /></main>
  if (loadKind === 'forbidden') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="forbidden" /></main>
  if (loadKind === 'error') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="error" title="写真を読み込めませんでした" /></main>
  if (!photo || loadKind === 'empty') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="empty" title="確認する写真はありません" /></main>

  const risks = Array.isArray(photo.risks) ? photo.risks as Array<Record<string, unknown>> : []
  const hasFaceRisk = risks.some((risk) => text(risk.flag) === 'face')
  const reviewDerivative = derivatives?.items.find((item) => item.kind === 'review') ?? null
  // 派生画像・原本どちらも検査を通す。だめな値は作り直し中の表示にする。
  const reviewUrl = safePhotoSrc(derivatives?.knownUrls.find((item) => item.kind === 'review')?.url)
    ?? safePhotoSrc(photo.image_url)
  const latestAssetJob = assetStatus?.jobs[0] ?? null
  return <main className="mx-auto max-w-screen-2xl p-6" data-photo-view="detail">
    {notice && <div className="mb-4 rounded-control border border-accent-border bg-accent-soft px-4 py-3 text-sm text-accent-hover">{notice}</div>}
    <div className="flex items-center justify-between gap-2 max-md:flex-col max-md:items-start">
      <div>
        <p className="text-xs font-bold text-ink-faint">写真審査</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{photoPetDisplayName(photo.pet_name, { honorific: false })} の写真</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs font-bold text-ink-secondary">{total > 0 ? `${total}枚のうち ${position + 1}枚目` : '—'}</span>
        <Button disabled={position <= 0} onClick={() => onMove(-1)}>前の写真</Button>
        <Button disabled={position >= total - 1} onClick={() => onMove(1)}>次の写真</Button>
        <Button onClick={onBack}>並べて見るへ戻る</Button>
      </div>
    </div>

    {hasFaceRisk && <div className="mt-4"><NoteBar tone="warn">うしろに人の顔が写っている可能性があります（自動で見つけました）</NoteBar></div>}

    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
      <Card className="xl:col-span-3" overflow="hidden">
        <div className="grid h-96 place-items-center overflow-hidden bg-ink lg:h-160">
          {reviewUrl ? <img
            src={reviewUrl}
            alt={`${photoPetDisplayName(photo.pet_name, { honorific: false })}の審査用写真`}
            className="h-full w-full object-contain transition-transform"
            style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
          /> : <p className="text-xs font-bold text-ink-faint">審査用の画像を作成中です</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
          <Button onClick={() => setScale((value) => Math.min(1.5, value + 0.1))}>大きく</Button>
          <Button onClick={() => setScale((value) => Math.max(0.7, value - 0.1))}>小さく</Button>
          <Button onClick={() => setRotation((value) => value + 90)}>回す</Button>
          <Button disabled title="切り取りは派生画像の生成口を接続後に使えます">切り取る</Button>
          <Button disabled={assetProcessing} onClick={onProcessReviewAsset}>{assetProcessing ? '作成中...' : '審査用画像を作り直す'}</Button>
          <Button onClick={() => { setDownloadOpen(true); setDownloadCode(''); setDownloadError('') }}>もとの画像を保存</Button>
        </div>
        <p className="px-4 pb-4 pt-1 text-xs text-ink-faint">{numberOrDash(reviewDerivative?.width ?? photo.image_width)} × {numberOrDash(reviewDerivative?.height ?? photo.image_height)} ／ {(reviewDerivative?.byteSize ?? photo.image_byte_size) == null ? '—（未取得）' : `${(Number(reviewDerivative?.byteSize ?? photo.image_byte_size) / 1024 / 1024).toFixed(1)}MB`} ／ {text(photo.captured_device) || '—（未取得）'}　派生画像：{reviewDerivative ? `審査用 v${reviewDerivative.sourceVersion}` : latestAssetJob ? `${assetStatusLabel(latestAssetJob.status)}（v${latestAssetJob.requestedVersion}）` : '未取得'}</p>
        {assetsFailed ? <div className="flex items-center gap-2 px-4 pb-4"><p className="text-xs text-ink-faint">審査用画像の状態を読み込めませんでした。</p><Button onClick={onReloadAssets}>状態を読み直す</Button></div> : null}
      </Card>

      <aside className="flex flex-col gap-3">
        <Card padding="default">
          <dl>
            <div><dt className="text-xs font-bold text-ink-faint">送ってくれた人</dt><dd className="mt-1 text-xs font-bold text-ink">{text(photo.owner_name) || '名前未取得'}</dd><small className="mt-1 block text-xs text-ink-faint">投稿 {numberOrDash(photo.submission_count)}回目 ／ 戻したこと {numberOrDash(photo.returned_count)}回</small></div>
            <div className="mt-3 border-t border-hairline pt-3"><dt className="text-xs font-bold text-ink-faint">ペット</dt><dd className="mt-1 text-xs font-bold text-ink">{photoPetDisplayName(photo.pet_name, { fallback: '未取得', honorific: false })}（{text(photo.animal_type) === 'cat' ? '猫' : '犬'}・{text(photo.breed) || '品種未取得'}）</dd></div>
            <div className="mt-3 border-t border-hairline pt-3"><dt className="text-xs font-bold text-ink-faint">届いた日時</dt><dd className="mt-1 text-xs font-bold text-ink">{formatPhotoReceivedAt(photo.created_at)}</dd></div>
            <div className="mt-3 border-t border-hairline pt-3"><dt className="text-xs font-bold text-ink-faint">そえられた言葉</dt><dd className="mt-1 text-xs font-bold text-ink">{text(photo.caption) ? `「${text(photo.caption)}」` : 'コメントなし'}</dd></div>
          </dl>
        </Card>
        <Card padding="default">
          <h2 className="text-sm font-bold text-ink">自動で見つけたこと</h2>
          {risks.length === 0 ? <p className="mt-1 text-xs font-medium leading-relaxed text-ink-faint">注意候補はありません。公開の最終判断は人が行います。</p> : risks.map((risk, index) => <div key={`${text(risk.flag)}-${index}`} className="mt-3 border-t border-hairline pt-3">
            <strong>{text(risk.note) || text(risk.flag)}</strong>
            <span className="mt-1 block text-xs text-ink-faint">{risk.confidence == null ? '確からしさは未取得' : `可能性 ${Math.round(Number(risk.confidence) * 100)}%`}</span>
          </div>)}
        </Card>
        <FeatureLinkCard items={[
          { label: 'ECポイント', note: '通したら5ポイントの手続きを始める' },
          { label: 'LINE通知', note: '審査結果を本人へ送る' },
          { label: '登録メディア', note: '公開用画像の置き場' },
        ]} />
      </aside>
    </div>
    <div className="mt-4">
      <StickyBar
        status={`${total}枚のうち ${position + 1}枚目。あと${Math.max(0, total - position - 1)}枚あります。`}
        actions={<>
        <Button disabled={reviewing} onClick={onReturn}>戻す（理由を選ぶ）</Button>
        <Button disabled title="切り取り版の生成口を接続後に使えます">切り取ってから通す</Button>
        <Button variant="primary" disabled={reviewing} onClick={onApprove}>{reviewing ? '処理中...' : 'このまま通す'}</Button>
        </>}
      />
    </div>
    <Dialog open={downloadOpen} title="もとの画像を保存" description="原本には個人情報が含まれる場合があります。6桁の再認証コードを入力すると、一度だけ保存できます。" busy={downloadBusy} error={downloadError} confirmLabel="再認証して保存" cancelLabel="やめる" onCancel={() => { setDownloadOpen(false); setDownloadError('') }} onConfirm={() => {
      if (!/^\d{6}$/.test(downloadCode)) { setDownloadError('6桁の再認証コードを入力してください。'); return }
      setDownloadBusy(true)
      setDownloadError('')
      void onDownloadOriginal(downloadCode)
        .then(() => setDownloadOpen(false))
        .catch((error: unknown) => setDownloadError(error instanceof Error ? error.message : '原本を保存できませんでした。'))
        .finally(() => setDownloadBusy(false))
    }}>
      <label className="block text-sm font-semibold text-ink">再認証コード
        <input value={downloadCode} onChange={(event) => { setDownloadCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setDownloadError('') }} inputMode="numeric" autoComplete="one-time-code" placeholder="6桁のコード" className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
      </label>
    </Dialog>
  </main>
}

function assetStatusLabel(status: string) {
  if (status === 'queued') return '作成待ち'
  if (status === 'processing') return '作成中'
  if (status === 'failed') return '作成失敗'
  return '作成済み'
}
