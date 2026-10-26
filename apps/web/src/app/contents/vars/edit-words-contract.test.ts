import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 共通情報 編集の社内メモの説明（「メモ（お客さまには出ません）」）は
 * `edit/page-behavior.test.tsx` が描いて確かめる。ここは古い言葉へ戻さない見張りだけ。
 */
describe('共通情報編集の言葉（AYc6O）', () => {
  it('社内メモの説明を古い言葉へ戻さない', () => {
    const source = readUiSource(join(SRC, '../../v8/common-vars-edit/edit.tsx'), 'utf8')
    expect(source).not.toContain('お客さまには出せません')
  })
})
