import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 共通情報 編集（板 `AYc6O`）の言葉の確認。
 * 社内メモの説明は板どおり「出ません」にそろえる。
 */
describe('共通情報編集の言葉（AYc6O）', () => {
  it('社内メモの説明が板どおり', () => {
    const source = readFileSync(join(SRC, 'vars/edit/edit-v8.tsx'), 'utf8')
    expect(source).toContain('メモ（お客さまには出ません）')
    expect(source).not.toContain('お客さまには出せません')
  })
})
