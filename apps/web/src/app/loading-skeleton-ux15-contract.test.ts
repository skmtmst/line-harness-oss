import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 動きの点検（2026-10-07）15 番：初回の読み込みに骨組みが無かった 3 画面。
 * - タグ（タグ）：読み込みの間ずっと「まだタグがありません」と出ていた（嘘の空）
 * - 受信箱・友だち追加時の配信：「読み込んでいます」の文だけで、出来上がりの形が無かった
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(join(SRC, file), 'utf8')

describe('初回の読み込みの骨組み', () => {
  it('タグ：空・該当なしの案内は読み終えてから（status が ready のときだけ）', () => {
    const source = read('app/tags/tags-tab-v8.tsx')
    expect(source).toMatch(/status === 'ready' && !staleAccount && items\.length === 0 \?/)
    expect(source).toMatch(/status === 'ready' && !staleAccount && visible\.length === 0 \?/)
    expect(source).not.toMatch(/\) : items\.length === 0 \?/)
  })

  it.each([
    ['v8/friend-add/list.tsx', '友だち追加時の配信を読み込んでいます'],
    ['app/chats/page.tsx', '会話を読み込んでいます...'],
  ])('%s は DelayedSkeleton で行の形を出し、読み上げの文は残す', (file, text) => {
    const source = read(file)
    const at = source.indexOf(text)
    expect(at).toBeGreaterThan(-1)
    const near = source.slice(at - 400, at + 600)
    expect(near).toContain('<DelayedSkeleton')
    expect(near).toContain('sr-only')
  })
})
