import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { WEBINAR_SAKURA_COMMENTS_MAX } from '../../../components/webinars/webinar-limits'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 ウェビナーさくらコメントの件数上限の契約', () => {
  it('上限は200件でサーバーと画面が同じ値を見る', () => {
    expect(WEBINAR_SAKURA_COMMENTS_MAX).toBe(200)
  })

  it('上限を超えた保存は送らず理由を出す', () => {
    expect(PAGE).toContain('WEBINAR_SAKURA_COMMENTS_MAX')
    expect(PAGE).toContain('if (comments.length > WEBINAR_SAKURA_COMMENTS_MAX)')
    expect(PAGE).toContain('件までです')
  })

  it('一括インポートの案内に上限を書く', () => {
    expect(PAGE).toContain('{WEBINAR_SAKURA_COMMENTS_MAX}件まで')
  })
})
