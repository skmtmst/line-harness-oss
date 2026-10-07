import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PETS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pets-v8.tsx'), 'utf8')

/** ペット一覧の読み込み失敗（板 `dzx5D`）の言葉を絵に合わせる歯止め。 */
describe('dzx5D ペットの読み込み失敗', () => {
  it('ペットの名前で読み込めなかったと言い、もう一度試す口を出す', () => {
    expect(PETS).toContain('ペットを読み込めませんでした')
    expect(PETS).toContain('もう一度試す')
  })
})
