import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const page = readFileSync(join(here, 'page.tsx'), 'utf8')
const detail = readFileSync(join(here, 'photo-review-detail.tsx'), 'utf8')
const publications = readFileSync(join(here, 'photo-publications.tsx'), 'utf8')
const api = readFileSync(join(here, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 写真審査の一枚表示と掲載管理', () => {
  it('opens both real states from the existing photo-review route', () => {
    expect(page).toContain('data-qa-open="hHrz8"')
    expect(page).toContain("setView('publications')")
    expect(page).toContain('api.nenMembers.photo(id, selectedAccountId)')
    expect(api).toContain('/api/nen-members/photos/publications?accountId=')
  })

  it('separates loading, empty, error and permission states with ListState', () => {
    for (const source of [detail, publications]) {
      expect(source).toContain("import ListState from '@/components/shared/list-state'")
      expect(source).toContain('kind="loading"')
      expect(source).toContain('kind="empty"')
      expect(source).toContain('kind="error"')
      expect(source).toContain('kind="forbidden"')
    }
  })

  it('does not expose an original URL and only downloads it after photo-specific step-up', () => {
    expect(detail).not.toContain('r2_key')
    expect(detail).not.toContain('image_url_original')
    expect(detail).toContain('6桁の再認証コードを入力すると、一度だけ保存できます。')
    expect(page).toContain('api.nenMembers.photoOriginalStepUp(code)')
    expect(page).toContain('api.nenMembers.issuePhotoOriginalDownload(')
    expect(page).toContain('api.nenMembers.downloadPhotoOriginal(issued.data.downloadUrl)')
    expect(page).toContain('URL.createObjectURL(blob)')
    expect(page).toContain("throw new Error('再認証コードを確認してください。')")
  })

  it('uses the review derivative when available and exposes its generation status', () => {
    expect(detail).toContain("derivatives?.knownUrls.find((item) => item.kind === 'review')")
    expect(detail).toContain("derivatives?.items.find((item) => item.kind === 'review')")
    expect(detail).toContain('審査用画像を作り直す')
    expect(detail).toContain('派生画像：')
  })

  it('keeps human review final and sends the expected version', () => {
    expect(detail).toContain('公開の最終判断は人が行います')
    // #580: 版は整数検査つきの reviewVersionOf で取り出す（壊れた値は初版に倒す）。
    expect(page).toContain('expectedVersion: reviewVersionOf(')
    expect(api).toContain('expectedVersion: number')
  })

  it('does not turn an unavailable view count into zero', () => {
    expect(publications).toContain("value == null ? '—（未取得）'")
    expect(publications).toContain('表示回数は未取得')
    expect(publications).toContain('withdrawPhotoPublication')
    expect(publications).toContain('updatePhotoPublicationPlacements')
    expect(publications).toContain('使う場所を保存')
    expect(publications).toContain('crypto.randomUUID()')
  })

  it('keeps withdrawn placements traceable after withdrawal (Issue #1040)', () => {
    // 掲載管理は「同意撤回で残った掲載先」と「外し済み」を分けて出す。
    expect(publications).toContain('pendingWithdrawals')
    expect(publications).toContain('withdrawnItems')
    expect(publications).toContain('整理が必要なもの')
    expect(publications).toContain('ご本人が公開の同意を撤回しました')
    expect(publications).toContain('外したもの')
    expect(publications).toContain('removed_at')
    // 外す操作と「付与済みマイルは戻らない」説明を残す
    expect(publications).toContain('掲載先から外す')
    expect(publications).toContain('付与済みのマイルは戻りません')
    expect(api).toContain('pendingWithdrawals')
    expect(api).toContain('withdrawnItems')
  })

  it('shows adoption history, reward state and placements in the detail (Issue #1040)', () => {
    // 詳細は採用履歴・同意・公開先・マイルの実状態をカードで出す。
    expect(detail).toContain('採用・同意・公開の記録')
    expect(detail).toContain('審査の記録')
    expect(detail).toContain('公開の同意')
    expect(detail).toContain('photo.history')
    expect(detail).toContain('photo.reward')
    expect(detail).toContain('photo.publication')
    expect(detail).toContain('publication_consent_version')
    expect(detail).toContain('採用1回につき付与は1回')
    expect(api).toContain('NenPhotoRewardState')
    expect(api).toContain('NenPhotoPublicationPlacement')
    expect(api).toContain('NenPhotoPublicationRecord')
  })
})
