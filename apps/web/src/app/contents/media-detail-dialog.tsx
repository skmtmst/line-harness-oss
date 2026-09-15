'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MediaDeleteImpactReference, MediaItem } from '@line-crm/shared'
import { ApiError, api, type MediaVersionPreview } from '@/lib/api'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { formatMediaSize } from './media-usage-display'
import { checkedAtText, referenceKindText, referenceNameText } from './media-delete-impact'
import {
  setMediaUsageReference,
  type MediaUsageImpact,
  type MediaUsageReferenceItem,
  type MediaUsageReferenceState,
  type MediaUsageReferenceTarget,
} from './media-usage-references'
import {
  fileMatchesMediaKind,
  mediaAcceptForKind,
  putMediaFile,
  validateMediaFile,
} from './media-direct-upload'

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—（未取得）'
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' }).format(date)
}

function mediaKind(item: MediaItem): string {
  if (item.kind === 'image') return item.mimeType.split('/')[1]?.toUpperCase() || '画像'
  if (item.kind === 'video') return 'MP4'
  if (item.kind === 'audio') return item.mimeType.includes('mp4') ? 'M4A' : 'MP3'
  return 'PDF'
}

function mediaLimit(item: MediaItem): string {
  if (item.kind === 'image') return '画像は 10MB まで'
  if (item.kind === 'video') return '動画は 200MB まで'
  if (item.kind === 'audio') return '音声は 200MB まで'
  return 'PDFは 20MB まで'
}

function mediaDimensions(item: MediaItem): string {
  if (item.width != null && item.height != null) return `${item.width} × ${item.height} px`
  if (item.durationMs != null) {
    const totalSeconds = Math.round(item.durationMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
  }
  return '—（未取得）'
}

/** 使用先の今の参照方法を短い言葉で。切替選択肢の現在値でも使う。 */
function usageModeText(reference: MediaUsageReferenceState | null): string {
  if (!reference) return '参照方法は未取得'
  switch (reference.mode) {
    case 'live':
      return '常に最新版（ライブ参照）'
    case 'pinned':
      return `第${reference.versionNo ?? '?'}版に固定`
    case 'mixed':
      return '複数の参照が混在しています'
    case 'unknown':
      return '参照の形を判別できません'
    default:
      return '参照の形を判別できません'
  }
}

/** 切替セレクトの現在値。ライブ・固定以外は選択肢を出さない。 */
function usageSelectValue(reference: MediaUsageReferenceState | null): string | null {
  if (!reference) return null
  if (reference.mode === 'live') return 'live'
  if (reference.mode === 'pinned' && reference.versionNo != null) return `v:${reference.versionNo}`
  return null
}

export default function MediaDetailDialog({
  item,
  accountId,
  folderName,
  canManage,
  onClose,
  onOpenReplacement,
  onVersionCreated,
}: {
  item: MediaItem | null
  accountId: string | null
  folderName: string
  /** owner/admin のみ true。staff には押して失敗する口を見せない。 */
  canManage: boolean
  onClose: () => void
  onOpenReplacement: (item: MediaItem) => void
  onVersionCreated: (message: string) => void
}) {
  const fileInputId = useId()
  const requestRef = useRef(0)
  const [impact, setImpact] = useState<MediaUsageImpact | null>(null)
  const [usageSwitching, setUsageSwitching] = useState<string | null>(null)
  const [usageError, setUsageError] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [versionFile, setVersionFile] = useState<File | null>(null)
  const [versionPhase, setVersionPhase] = useState<'idle' | 'uploading' | 'preview' | 'publishing' | 'error'>('idle')
  const [versionProgress, setVersionProgress] = useState(0)
  const [versionPreview, setVersionPreview] = useState<MediaVersionPreview | null>(null)
  const [changeReason, setChangeReason] = useState('')
  const [versionError, setVersionError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  /** 保存URLへ直接行かず、権限確認と監査を通る口から受け取って保存させる。 */
  const displaySrc = item && accountId ? api.media.contentUrl(item.id, accountId) : ''

  async function downloadItem() {
    if (!item || !accountId || downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      const blob = await api.media.download(item.id, accountId)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = item.filename
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'ダウンロードできませんでした')
    } finally {
      setDownloading(false)
    }
  }

  const loadImpact = useCallback(async () => {
    if (!item || !accountId) {
      setImpact(null)
      setPhase('error')
      return
    }
    const request = requestRef.current + 1
    requestRef.current = request
    setImpact(null)
    setPhase('loading')
    setUsageError('')
    try {
      const response = await api.media.deleteImpact(item.id, accountId)
      if (requestRef.current !== request) return
      if (!response.success) throw new Error('impact_failed')
      // 応答には使用先ごとの参照モードと版一覧が足されている。
      setImpact(response.data as MediaUsageImpact)
      setPhase('ready')
    } catch {
      if (requestRef.current === request) setPhase('error')
    }
  }, [accountId, item])

  /** 1つの使用先だけを、ライブ参照または指定した版へ切り替える。 */
  async function switchUsageReference(reference: MediaUsageReferenceItem, value: string) {
    if (!item || !accountId || !reference.refKind || !reference.refId || usageSwitching) return
    let target: MediaUsageReferenceTarget | null = null
    if (value === 'live') {
      target = { refKind: reference.refKind, refId: reference.refId, mode: 'live' }
    } else if (value.startsWith('v:')) {
      const versionNo = Number.parseInt(value.slice(2), 10)
      if (Number.isInteger(versionNo) && versionNo >= 1) {
        target = { refKind: reference.refKind, refId: reference.refId, mode: 'pinned', versionNo }
      }
    }
    if (!target) return
    const request = `${reference.refKind}:${reference.refId}`
    setUsageSwitching(request)
    setUsageError('')
    try {
      const response = await setMediaUsageReference(item.id, accountId, target)
      if (!response.success) throw new Error(response.error)
      await loadImpact()
    } catch (caught) {
      setUsageError(caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : '参照方法を切り替えられませんでした')
    } finally {
      setUsageSwitching(null)
    }
  }

  useEffect(() => {
    void loadImpact()
    return () => {
      requestRef.current += 1
    }
  }, [loadImpact])

  useEffect(() => {
    setVersionFile(null)
    setVersionPhase('idle')
    setVersionProgress(0)
    setVersionPreview(null)
    setChangeReason('')
    setVersionError('')
  }, [item?.id])

  function chooseVersionFile(file: File | null) {
    setVersionPreview(null)
    setVersionProgress(0)
    setVersionError('')
    if (!file || !item) {
      setVersionFile(null)
      setVersionPhase('idle')
      return
    }
    const validation = validateMediaFile(file)
    if (validation) {
      setVersionFile(null)
      setVersionPhase('error')
      setVersionError(validation)
      return
    }
    if (!fileMatchesMediaKind(file, item.kind)) {
      setVersionFile(null)
      setVersionPhase('error')
      setVersionError('いまのメディアと同じ種類のファイルを選んでください')
      return
    }
    setVersionFile(file)
    setVersionPhase('idle')
  }

  async function prepareVersion() {
    if (!item || !accountId || !versionFile || versionPhase === 'uploading') return
    setVersionPhase('uploading')
    setVersionProgress(0)
    setVersionError('')
    setVersionPreview(null)
    try {
      const prepared = await api.media.prepareUploads({
        accountId,
        files: [{
          filename: versionFile.name,
          mimeType: versionFile.type,
          sizeBytes: versionFile.size,
          targetMediaId: item.id,
        }],
      })
      const session = prepared.success ? prepared.data.sessions[0] : null
      if (!session) throw new Error('送信の準備結果を確認できませんでした')
      const etag = await putMediaFile(session, versionFile, setVersionProgress)
      const completed = await api.media.completeUpload(session.id, { accountId, etag })
      if (!completed.success || completed.data.status !== 'verified') {
        throw new Error('差し替え用ファイルを確認できませんでした')
      }
      const previewed = await api.media.previewVersion(item.id, {
        accountId,
        uploadSessionId: session.id,
      })
      if (!previewed.success) throw new Error(previewed.error)
      setVersionPreview(previewed.data)
      setVersionPhase('preview')
    } catch (caught) {
      setVersionPhase('error')
      setVersionError(caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : '差し替え内容を確認できませんでした')
    }
  }

  async function publishVersion() {
    if (!item || !accountId || !versionPreview?.canReplace || !changeReason.trim()) return
    setVersionPhase('publishing')
    setVersionError('')
    try {
      const response = await api.media.createVersion(item.id, {
        accountId,
        uploadSessionId: versionPreview.uploadSessionId,
        previewToken: versionPreview.previewToken,
        changeReason: changeReason.trim(),
      })
      if (!response.success) throw new Error(response.error)
      onVersionCreated(`「${item.filename}」へ第${response.data.versionNo}版を追加しました。使用先の固定版は変えていません。`)
    } catch (caught) {
      setVersionPhase('preview')
      setVersionError(caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : '新しい版を追加できませんでした')
    }
  }

  if (!item) return null

  return (
    <div data-design-node="voJtX" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="現在位置" className="text-action flex flex-wrap items-center gap-2 text-xs font-semibold">
            <a
              href="/contents"
              onClick={(event) => {
                event.preventDefault()
                onClose()
              }}
              className="hover:underline"
            >
              登録メディア
            </a>
            <span aria-hidden="true">›</span>
            <span>{folderName}</span>
            <span aria-hidden="true">›</span>
            <span className="text-ink-faint max-w-md truncate" title={item.filename}>{item.filename}</span>
          </nav>
          <h2 className="text-ink mt-3 truncate text-xl font-bold" title={item.filename}>{item.filename}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void downloadItem()} disabled={downloading}>
            {downloading ? '取得中…' : 'ダウンロード'}
          </Button>
          {downloadError ? <p className="text-danger text-xs" role="alert">{downloadError}</p> : null}
          {impact && impact.usageCount > 0 ? (
            <Button type="button" variant="primary" onClick={() => onOpenReplacement(item)}>使用先を差し替える</Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <main className="space-y-4 xl:col-span-2">
          <div className="bg-canvas-sunken rounded-card flex min-h-96 items-center justify-center overflow-hidden border border-hairline">
            {item.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displaySrc} alt={item.filename} className="max-h-96 max-w-full object-contain" />
            ) : item.kind === 'video' ? (
              <video src={displaySrc} controls className="max-h-96 max-w-full" />
            ) : item.kind === 'audio' ? (
              <audio src={displaySrc} controls />
            ) : (
              <a href={displaySrc} target="_blank" rel="noreferrer" className="text-action text-sm font-semibold">PDFを開く</a>
            )}
          </div>

          <section className="border-hairline rounded-card border bg-canvas p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-ink text-sm font-bold">この{item.kind === 'image' ? '画像' : 'メディア'}を差し替える</h3>
                <p className="text-ink-faint mt-1 text-xs">名前と管理用URLを保ったまま新しい版を追加します。</p>
              </div>
              <span className="bg-accent-soft text-accent-deep rounded-pill px-2 py-1 text-xs font-semibold">安全確認して追加</span>
            </div>
            <label
              htmlFor={fileInputId}
              className="border-info text-info rounded-control mt-4 flex min-h-24 cursor-pointer items-center justify-center border border-dashed p-4 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                chooseVersionFile(event.dataTransfer.files[0] ?? null)
              }}
            >
              <div>
                <p className="text-sm font-bold">ここにファイルをドラッグ、または押して選ぶ</p>
                <p className="text-ink-faint mt-1 text-xs">いまのメディアと同じ種類を選びます。</p>
                {versionFile ? <p className="text-ink mt-2 text-xs font-bold">{versionFile.name}</p> : null}
              </div>
            </label>
            <input id={fileInputId} type="file" className="sr-only" accept={mediaAcceptForKind(item.kind)} onChange={(event) => chooseVersionFile(event.target.files?.[0] ?? null)} />
            {versionPhase === 'uploading' ? (
              <div className="mt-3" aria-live="polite">
                <div className="flex justify-between text-xs"><span>保存先へ直接送信しています</span><span>{versionProgress}%</span></div>
                <progress className="mt-1 h-1 w-full" max={100} value={versionProgress} aria-label="差し替えファイルの送信進捗" />
              </div>
            ) : null}
            {versionPreview ? (
              <div className={versionPreview.canReplace ? 'bg-accent-soft text-accent-deep mt-3 rounded-control p-3 text-xs' : 'bg-danger-bg text-danger mt-3 rounded-control p-3 text-xs'}>
                {versionPreview.canReplace
                  ? `現在の第${versionPreview.currentVersionNo}版から第${versionPreview.currentVersionNo + 1}版へ追加できます。`
                  : 'ファイルの種類が違うため、このメディアへ追加できません。'}
              </div>
            ) : null}
            {versionPreview?.canReplace ? (
              <div className="mt-3">
                <label htmlFor={`${fileInputId}-reason`} className="text-ink-secondary block text-xs font-semibold">変更理由</label>
                <input id={`${fileInputId}-reason`} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={500} className="border-hairline rounded-control mt-1 min-h-10 w-full border px-3 text-sm" placeholder="例：秋の写真へ更新" />
              </div>
            ) : null}
            {versionError ? <p className="bg-danger-bg text-danger mt-3 rounded-control p-3 text-xs" role="alert">{versionError}</p> : null}
            {impact && impact.usageCount > 0 ? (
              <p className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs font-semibold leading-5">
                新しい版を追加しても、現在このメディアを使っている{impact.usageCount}か所の固定版は変わりません。使う場所ごとに切り替えてください。
              </p>
            ) : null}
            <div className="mt-4 flex justify-end">
              {versionPreview?.canReplace ? (
                <Button type="button" variant="primary" onClick={() => void publishVersion()} disabled={!changeReason.trim() || versionPhase === 'publishing'}>
                  {versionPhase === 'publishing' ? '追加しています…' : '新しい版を追加する'}
                </Button>
              ) : (
                <Button type="button" variant="primary" onClick={() => void prepareVersion()} disabled={!versionFile || versionPhase === 'uploading'}>
                  差し替え内容を確認
                </Button>
              )}
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="border-hairline rounded-card border bg-canvas p-4">
            <h3 className="text-ink text-sm font-bold">ファイルのこと</h3>
            <dl className="mt-4 space-y-3 text-xs">
              {[
                ['種類', mediaKind(item)],
                ['大きさ', mediaDimensions(item)],
                ['容量', formatMediaSize(item.sizeBytes)],
                ['入れた日', formatDate(item.createdAt)],
                ['入れた人', item.uploadedBy || '—（未取得）'],
                ['LINEの上限', mediaLimit(item)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <dt className="text-ink-faint">{label}</dt>
                  <dd className="text-ink text-right font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-hairline rounded-card border bg-canvas p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-ink text-sm font-bold">使われている場所</h3>
              <span className="text-action text-xs font-bold">{impact ? `${impact.usageCount}か所` : '—'}</span>
            </div>
            {phase === 'loading' ? (
              <p className="text-ink-faint mt-3 text-xs">使われている場所を確認しています…</p>
            ) : phase === 'error' ? (
              <div className="mt-3 space-y-2" role="alert">
                <p className="text-danger text-xs">使われている場所を確認できませんでした。</p>
                <Button type="button" onClick={() => void loadImpact()}>読み直す</Button>
              </div>
            ) : impact && impact.references.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {impact.references.map((reference: MediaDeleteImpactReference, index) => {
                  const usage = reference as MediaUsageReferenceItem
                  const selectValue = usageSelectValue(usage.reference)
                  const canSwitch = canManage
                    && usage.state === 'available'
                    && usage.refKind !== null
                    && usage.refId !== null
                    && usage.refKind !== 'webinar'
                    && selectValue !== null
                  const options = [
                    ...(usage.refKind === 'rich_menu' ? [] : [{ value: 'live', label: '常に最新版（ライブ参照）' }]),
                    ...(impact.versions ?? []).map((version) => ({
                      value: `v:${version.versionNo}`,
                      label: `第${version.versionNo}版に固定${version.isCurrent ? '（最新）' : ''}`,
                    })),
                  ]
                  const itemKey = `${usage.refKind}:${usage.refId}`
                  return (
                    <li key={`${reference.kind}-${index}`} className="border-hairline rounded-control border p-3 text-xs">
                      <p className="text-ink font-semibold">{referenceKindText(reference.kind)}「{referenceNameText(reference)}」</p>
                      <p className="text-ink-faint mt-1">{usageModeText(usage.reference)}</p>
                      {canSwitch ? (
                        <div className="mt-2">
                          <Select
                            aria-label="この場所の参照方法"
                            value={selectValue}
                            options={options}
                            onChange={(value) => void switchUsageReference(usage, value)}
                            disabled={usageSwitching !== null}
                          />
                          {usageSwitching === itemKey ? (
                            <p className="text-ink-faint mt-1" aria-live="polite">切り替えています…</p>
                          ) : null}
                        </div>
                      ) : null}
                      {reference.href ? <a href={reference.href} className="text-action mt-2 inline-flex font-semibold">ここを開く</a> : <p className="text-ink-faint mt-2">この画面からは開けません</p>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-ink-faint mt-3 text-xs">どこでも使われていません。</p>
            )}
            {usageError ? <p className="text-danger mt-3 text-xs" role="alert">{usageError}</p> : null}
            {impact ? <p className="text-ink-faint mt-3 text-xs">{checkedAtText(impact.checkedAt)} 時点で確認</p> : null}
            {impact && impact.usageCount > 0 ? (
              <p className="text-ink-faint mt-3 text-xs leading-5">使われているあいだは削除できません。先にこの{impact.usageCount}か所から外してください。</p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  )
}
