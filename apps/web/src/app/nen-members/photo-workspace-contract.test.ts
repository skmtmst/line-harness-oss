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
    expect(page).toContain('expectedVersion: Number(')
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
})
