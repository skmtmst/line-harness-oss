import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('ダッシュボード集計範囲と深掘り先の一致(#666)', () => {
  it('N-002:写真審査は選択中アカウントの審査待ちAPIで数え、全社概要を使わない', () => {
    expect(PAGE).toContain('api.nenMembers.photoReviewMetrics(selectedAccountId)')
    expect(PAGE).toContain('photoResult.value.data.pendingCount')
    expect(PAGE).not.toContain('api.nenMembers.overview()')
  })

  it('N-002:勘定を切り替えたら前の勘定の件数を消し、古い数を出さない', () => {
    expect(PAGE).toContain('setPendingPhotos(null)')
  })

  it('N-004:写真審査の深掘りは写真タブ・審査待ち絞りを引き継ぐ', () => {
    expect(PAGE).toContain('/nen-members?tab=photos&status=pending_review')
    expect(PAGE).not.toContain('href="/nen-members?tab=photos"')
  })
})
