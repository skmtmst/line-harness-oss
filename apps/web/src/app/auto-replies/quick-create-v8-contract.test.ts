import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 自動応答 かんたんに作る（板 G4GejG）の用語の見張り。
 * 窓・欄を離れたときの確かめは quick-create-v8-react.test.tsx、
 * 下書き→重なりの確認→公開は v8/auto-replies/quick-create.test.tsx が押して見る。
 */
describe('かんたんに作るの用語（G4GejG）', () => {
  const source = readFileSync(join(SRC, '../v8/auto-replies/quick-create.tsx'), 'utf8')

  it('用語の決まりを守る', () => {
    expect(source).not.toMatch(/全て/)
    expect(source).not.toMatch(/友達/)
  })
})
