import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'photo-review-v8.tsx'), 'utf8')
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')
const detail = readFileSync(join(import.meta.dirname, 'photo-review-detail.tsx'), 'utf8')
const helper = readFileSync(join(import.meta.dirname, 'photo-text.ts'), 'utf8')

describe('投稿V8のAPIと失敗時の契約', () => {
  it('選んだアカウントと検索・ページを使い、古い取得結果を捨てる', () => {
    expect(page).toContain('fetchApi<PhotoPageResponse>(photoPagePath(accountId, 0, searchQuery))')
    expect(page).toContain('photoPagePath(accountId, photos.length, searchQuery)')
    expect(page).toContain('sequence !== loadSequence.current')
    expect(page).toContain('generation !== accountGeneration.current')
  })
  it('読み込み・空・権限・失敗を分け、未取得の数を0としない', () => {
    for (const kind of ['loading', 'empty', 'forbidden', 'error']) expect(page).toContain(`kind="${kind}"`)
    expect(page).toContain('const countsReady = Boolean(accountId) && !loading && !loadError')
    expect(page).toContain('value === null')
    expect(page).toContain('photoReviewMetrics(accountId)')
    expect(page).toContain('reasonCounts')
    expect(page).not.toContain('自動審査を実行')
  })
  it('見送りは理由と補足、再投稿の案内、次の投稿の確認指定を送る', () => {
    for (const value of ['quality', 'privacy', 'unrelated', 'duplicate', 'other']) expect(page).toContain(`value: '${value}'`)
    expect(page).toContain("reasonCode === 'other' && !reasonNote.trim()")
    expect(page).toContain('resubmitInvite: rejection.resubmitInvite')
    expect(page).toContain('watchSubmitter: rejection.watchSubmitter')
    expect(page).toContain('formatPhotoReceivedAt(photo.created_at)')
  })
  it('選択した審査待ちだけをまとめ、報酬は現在の版を使い、自動公開しない', () => {
    expect(page).toContain('selectedPendingPhotos.map')
    expect(page).toContain('selectedPhotosAreLowRisk')
    expect(page).toContain('selectedPendingPhotos.length * policyPoints')
    expect(page).toContain('公開しない')
    expect(page).toContain('publication_withdrawn_at')
    expect(page).toContain('withoutReward: true')
  })
  it('審査の保存と通知の失敗を分け、通知だけ再送できる', () => {
    expect(page).toContain("response.data.notificationStatus === 'sent'")
    expect(page).toContain('notificationFailures')
    expect(page).toContain('通知だけ再送できます')
    expect(page).toContain('retryPhotoReviewNotification')
    expect(api).toContain('notificationFailures: Array<{ photoId: string; error: string }>')
  })
  it('壊れた版を整数に直し、409は最新を読み直し、元画像は再認証後にだけ取得する', () => {
    expect(page).toContain('reviewVersionOf(')
    expect(helper).toContain('Number.isInteger(version)')
    expect(page).toContain('error.status === 409')
    expect(page).toContain('api.nenMembers.photoOriginalStepUp(')
    expect(page).toContain('api.nenMembers.issuePhotoOriginalDownload(')
    expect(page).toContain('api.nenMembers.downloadPhotoOriginal(')
    expect(detail).not.toContain('image_url_original')
  })
  it('派生画像の再作成と止まったマイルの再送・照合を残す', () => {
    expect(page).toContain('api.nenMembers.photoAssetStatus(')
    expect(page).toContain('api.nenMembers.photoDerivatives(')
    expect(page).toContain('api.nenMembers.processPhotoAssets(')
    expect(page).toContain('api.nenMembers.photoPointRetry(')
    expect(page).toContain('api.nenMembers.photoPointReconcile(')
    expect(page).toContain('すでに付与済みでした')
    expect(detail).toContain("onPointAction('retry')")
    expect(detail).toContain("onPointAction('reconcile')")
  })
})
