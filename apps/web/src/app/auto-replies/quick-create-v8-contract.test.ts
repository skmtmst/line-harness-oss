import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 自動応答 かんたんに作る（板 `G4GejG`、小窓 560）の配線の確認。
 *
 * 言葉（どれか1つを含む）と返す文だけ聞いて、その場で有効にする。
 * 重なりは作った下書きで確かめて帯に出し、確かめた分だけ承認する。
 */
describe('かんたんに作るの配線（G4GejG）', () => {
  const file = 'auto-replies/quick-create-v8.tsx'
  const source = readFileSync(join(SRC, file), 'utf8')

  it('板の印を持ち、共通の窓を使う', () => {
    expect(source).toContain('G4GejG')
    expect(source).toMatch(/from '@\/components\/shared\/dialog'/)
  })

  it('言葉と返す文を blur で確かめ、読み上げにも出す', () => {
    expect(source).toContain('onBlur')
    expect(source).toContain('role="alert"')
    expect(source).toMatch(/してください/)
  })

  it('下書きを作って重なりを確かめてから有効にする', () => {
    expect(source).toContain('createDraft')
    expect(source).toContain('conflicts')
    expect(source).toContain('publishDraft')
    // 確かめた重なりだけ承認する（全部通しにしない）。
    expect(source).toContain('acknowledgedConflictIds')
  })

  it('用語の決まりを守る', () => {
    expect(source).not.toMatch(/全て/)
    expect(source).not.toMatch(/友達/)
  })
})
