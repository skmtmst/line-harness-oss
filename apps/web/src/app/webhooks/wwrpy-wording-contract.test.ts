import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUTGOING = readFileSync(join(DIR, 'outgoing-v8.tsx'), 'utf8')

/** 外部連携の送り先タブの読み込み失敗（板 `wWrpY`）の言葉を絵に合わせる歯止め。 */
describe('wWrpY 送り先の読み込み失敗', () => {
  it('外部連携の名前で読み込めなかったと言い、もう一度試す口を出す', () => {
    expect(OUTGOING).toContain('外部連携を読み込めませんでした')
    expect(OUTGOING).toContain('もう一度試す')
  })
})
