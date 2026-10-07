import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const REVIEW = readFileSync(join(DIR, 'change-review-v8.tsx'), 'utf8')

/** イベント予約の変更の確認（板 `hmr2P`）の言葉を絵に合わせる歯止め。 */
describe('hmr2P 変更の確認', () => {
  it('変える回を選ぶ案内を出す', () => {
    expect(REVIEW).toContain('変える回を選びます')
    expect(REVIEW).not.toContain('選ぶます')
  })

  it('変えて知らせる実行ボタンを出す', () => {
    expect(REVIEW).toContain('変えてお知らせする')
    expect(REVIEW).toContain('変える理由')
  })
})
