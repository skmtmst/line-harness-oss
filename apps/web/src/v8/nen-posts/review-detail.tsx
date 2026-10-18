'use client'

import { SaveErrorScope,useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifySaved,notifyToast } from '@/components/shared/toast'
import { ApiError,api } from '@/lib/api'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import { useCallback,useEffect,useRef,useState } from 'react'
import { PhotoReviewDetail } from './detail'
import { photoNoticeFor } from './notice'
import { reviewVersionOf,text } from './text'

/**
 * 1枚ずつ大きく見る。審査の詳細部品を使う
 * （V8 の板に無いため。向きの保存・マイルの手続き・原本の取り出しを含む）。
 */
export function DetailV8({
  accountId,
  photos,
  initialPhotoId,
  canEdit,
  onPhotoChange,
  onReject,
  onBack,
  onReload,
}: {
  accountId: string
  initialPhotoId?: string
  canEdit: boolean
  onPhotoChange: (id: string) => void
  onReject: (id: string) => void
  photos: Array<Record<string, unknown>>
  onBack: () => void
  onReload: () => void
}) {
  const saveErrors = useSaveFormErrors()
  const [photoId, setPhotoId] = useState<string | null>(() => initialPhotoId ?? (photos.length > 0 ? text(photos[0].id) : null))
  const [detailPhoto, setDetailPhoto] = useState<Record<string, unknown> | null>(null)
  const [detailState, setDetailState] = useState<'ready' | 'empty' | 'error' | 'forbidden'>('empty')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAssetStatus, setDetailAssetStatus] = useState<import('@/lib/api').PhotoAssetStatus | null>(null)
  const [detailDerivatives, setDetailDerivatives] = useState<import('@/lib/api').PhotoDerivatives | null>(null)
  const [detailAssetsFailed, setDetailAssetsFailed] = useState(false)
  const [assetProcessing, setAssetProcessing] = useState(false)
  const [rotationSaving, setRotationSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [notice, setNotice] = useState('')
  const [pointActionBusy, setPointActionBusy] = useState<'retry' | 'reconcile' | null>(null)
  const sequenceRef = useRef(0)
  const reviewKeys = useRef(new Map<string, string>())
  const rotationKeys = useRef(new Map<string, string>())

  const position = photoId ? Math.max(0, photos.findIndex((photo) => text(photo.id) === photoId)) : 0

  const refreshDetailAssets = useCallback(async (id: string) => {
    const sequence = sequenceRef.current
    const [statusResult, derivativesResult] = await Promise.allSettled([
      api.nenMembers.photoAssetStatus(id, accountId),
      api.nenMembers.photoDerivatives(id, accountId),
    ])
    if (sequence !== sequenceRef.current) return
    const loaded = statusResult.status === 'fulfilled' && statusResult.value.success ? statusResult.value.data : null
    const derivatives = derivativesResult.status === 'fulfilled' && derivativesResult.value.success ? derivativesResult.value.data : null
    setDetailAssetStatus(loaded)
    setDetailDerivatives(derivatives)
    setDetailAssetsFailed(loaded === null || derivatives === null)
  }, [accountId])

  const openDetail = useCallback(async (id: string) => {
    const sequence = ++sequenceRef.current
    setPhotoId(id)
    setDetailPhoto(null)
    setDetailAssetStatus(null)
    setDetailDerivatives(null)
    setDetailAssetsFailed(false)
    setDetailLoading(true)
    try {
      const [response] = await Promise.all([
        api.nenMembers.photo(id, accountId),
        refreshDetailAssets(id),
      ])
      if (sequence !== sequenceRef.current) return
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setDetailState('empty')
        return
      }
      setDetailPhoto(response.data)
      setDetailState('ready')
    } catch (error) {
      if (sequence !== sequenceRef.current) return
      const fieldFailure = saveErrors.capture(error)
      { if (!fieldFailure)
      setDetailState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error') }
    } finally {
      if (sequence === sequenceRef.current) setDetailLoading(false)
    }
  }, [accountId, refreshDetailAssets, saveErrors])

  useEffect(() => {
    if (photoId) void openDetail(photoId)
    return () => { sequenceRef.current += 1 }
  }, [photoId, openDetail])
  useEffect(() => { if (initialPhotoId) setPhotoId(initialPhotoId) }, [initialPhotoId])

  const review = async (id: string, nextStatus: 'adopted' | 'rejected', withoutReward = false) => {
    if (!canEdit) return
    const idempotencyKey = reviewKeys.current.get(id) ?? crypto.randomUUID()
    reviewKeys.current.set(id, idempotencyKey)
    setReviewing(true)
    try {
      const response = await api.nenMembers.reviewPhoto(id, {
        accountId,
        status: nextStatus,
        ...(withoutReward ? { withoutReward: true } : {}),
        expectedVersion: reviewVersionOf(detailPhoto && text(detailPhoto.id) === id ? detailPhoto : photos.find((photo) => text(photo.id) === id)),
      }, idempotencyKey)
      if (!response.success) throw new Error(response.error)
      reviewKeys.current.delete(id)
      notifySaved(nextStatus === 'adopted' ? '写真を採用しました。公開は本人の同意がある場合だけ行います。' : '見送り理由を保存しました。')
      onReload()
      onBack()
    } catch (error) {
      const fieldFailure = saveErrors.capture(error)

      { if (!fieldFailure)
      setNotice(photoNoticeFor(error, '審査結果を保存できませんでした。')) }
    } finally { setReviewing(false) }
  }

  const pointAction = async (action: 'retry' | 'reconcile') => {
    if (!detailPhoto || !canEdit) return
    const id = text(detailPhoto.id)
    setPointActionBusy(action)
    try {
      const response = action === 'retry'
        ? await api.nenMembers.photoPointRetry(id, accountId)
        : await api.nenMembers.photoPointReconcile(id, accountId)
      if (!response.success) {
        setNotice(response.error || 'マイルの手続きに失敗しました。通信を確かめて、もう一度お試しください。')
        return
      }
      setNotice(response.data.synced ? (response.data.duplicate ? 'EC側ではすでに付与済みでした。' : 'マイルを付けました。') : '手続きはまだ完了していません。')
      void openDetail(id)
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)
      setNotice('マイルの手続きに失敗しました。通信を確かめて、もう一度お試しください。') }
    } finally {
      setPointActionBusy(null)
    }
  }

  const saveRotation = async (rotation: 0 | 90 | 180 | 270) => {
    if (!detailPhoto || !canEdit) return
    const id = text(detailPhoto.id)
    const idempotencyKey = rotationKeys.current.get(id) ?? crypto.randomUUID()
    rotationKeys.current.set(id, idempotencyKey)
    setRotationSaving(true)
    try {
      const response = await api.nenMembers.savePhotoRotation(id, {
        accountId,
        rotation,
        expectedVersion: reviewVersionOf(detailPhoto),
      }, idempotencyKey)
      if (!response.success) throw new Error(response.error)
      rotationKeys.current.delete(id)
      setDetailPhoto((current) => current && text(current.id) === id
        ? { ...current, display_rotation: rotation, review_version: response.data.reviewVersion }
        : current)
      notifySaved('写真の向きを保存しました。')
    } catch (error) {
      const fieldFailure = saveErrors.capture(error)

      { if (!fieldFailure)
      setNotice(photoNoticeFor(error, '写真の向きを保存できませんでした。')) }
    } finally {
      setRotationSaving(false)
    }
  }

  const downloadOriginal = async (code: string) => {
    if (!detailPhoto) throw new Error('写真を読み直してください。')
    const method = readSessionSnapshot()?.stepUpMethod ?? 'totp'
    if (method === 'none') throw new Error('原本の保存には再認証が必要です。管理者にご相談ください。')
    let grant
    try { grant = await api.nenMembers.photoOriginalStepUp({ method, value: code }) }
    catch (error) {
      saveErrors.capture(error);

      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) throw new Error('再認証コードを確認してください。')
      throw error
    }
    if (!grant.success) throw new Error(grant.error)
    const issued = await api.nenMembers.issuePhotoOriginalDownload(
      text(detailPhoto.id),
      { lineAccountId: accountId, expectedVersion: reviewVersionOf(detailPhoto) },
      grant.data.token,
      crypto.randomUUID(),
    )
    if (!issued.success) throw new Error(issued.error)
    const blob = await api.nenMembers.downloadPhotoOriginal(issued.data.downloadUrl)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `photo-${text(detailPhoto.id)}-original`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const move = (direction: 1 | -1) => {
    const next = photos[position + direction]
    if (next) { onPhotoChange(text(next.id)); setPhotoId(text(next.id)) }
  }

  const processReviewAsset = async () => {
    if (!detailPhoto || !canEdit) return
    const id = text(detailPhoto.id)
    setAssetProcessing(true)
    try {
      const response = await api.nenMembers.processPhotoAssets(id, {
        lineAccountId: accountId,
        expectedVersion: reviewVersionOf(detailPhoto),
        operation: 'review',
      }, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      notifyToast(response.data.status === 'completed'
        ? '審査用画像を作り直しました。'
        : '審査用画像の作り直しを受け付けました。')
      await refreshDetailAssets(id)
    } catch (error) {
      const fieldFailure = saveErrors.capture(error)

      { if (!fieldFailure)
      setNotice(photoNoticeFor(error, '審査用画像を作り直せませんでした。')) }
    } finally {
      setAssetProcessing(false)
    }
  }

  return (
    <SaveErrorScope errors={saveErrors}><PhotoReviewDetail
      canEdit={canEdit}
      photo={detailPhoto}
      position={position}
      total={photos.length}
      loading={detailLoading}
      loadKind={detailState}
      reviewing={reviewing}
      notice={notice}
      accountNotice=""
      assetStatus={detailAssetStatus}
      derivatives={detailDerivatives}
      assetsFailed={detailAssetsFailed}
      onReloadPhoto={() => { if (photoId) void openDetail(photoId) }}
      onReloadAssets={() => { if (photoId) void refreshDetailAssets(photoId) }}
      assetProcessing={assetProcessing}
      rotationSaving={rotationSaving}
      onBack={onBack}
      onMove={move}
      onApprove={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted') }}
      onAdoptWithoutReward={() => { if (detailPhoto) void review(text(detailPhoto.id), 'adopted', true) }}
      onReturn={() => { if (detailPhoto && canEdit) onReject(text(detailPhoto.id)) }}
      onProcessReviewAsset={() => void processReviewAsset()}
      onSaveRotation={(rotation) => saveRotation(rotation)}
      onDownloadOriginal={downloadOriginal}
      onPointAction={pointAction}
      pointActionBusy={pointActionBusy}
    /></SaveErrorScope>
  )
}
