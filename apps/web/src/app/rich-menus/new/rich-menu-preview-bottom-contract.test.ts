import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'create-v8.module.css'), 'utf8')

/** MenuPreview の本体（function MenuPreview から次の関数まで）。 */
const menuPreview = SRC.slice(SRC.indexOf('function MenuPreview('), SRC.indexOf('function groupFromSeed('))

/*
 * 2026-10-08 オーナー：本物の LINE はトーク画面のいちばん下（入力の帯の位置）にメニューが出て、トークはその上で縮む。
 * 絵 gobhu・egdGx・K0gu1・gQabc：画像が画面の下、その下に「メニュー ∨」の帯が1本。
 * 店・統括のリッチメニューの作る・編集（どれも create-v8 の renderLinePreview）で同じになる。
 */
describe('リッチメニューの「LINEでの見え方」はメニューを下に出す', () => {
  it('メニューはトークの中身（children）ではなく、下の置き場（richMenu）に渡す', () => {
    expect(SRC).toMatch(/<LinePreview[\s\S]{0,300}chatBarText=\{chatBarText\}[\s\S]{0,80}richMenu=\{\(\s*<MenuPreview/)
    expect(SRC).not.toMatch(/<LinePreview[^/]*>\s*<MenuPreview/)
  })

  it('帯は LinePreview の1本だけ（メニューの見本の中に2本目の帯を描かない）', () => {
    expect(menuPreview).not.toContain('previewMenuBar')
    expect(menuPreview).not.toContain('ChevronDown')
    expect(CSS).not.toContain('.previewMenuBar')
  })

  it('画像が無いときも、下のメニューの場所に「画像を選ぶと、ここに出ます（n面）」と面の区切りの点線を出す', () => {
    const empty = menuPreview.slice(menuPreview.indexOf('styles.previewMenuEmpty'))
    expect(empty).toContain('{areaBoxes}')
    expect(empty).toContain('画像を選ぶと、ここに出ます')
    expect(menuPreview).toContain('aspectRatio: `${dims.width} / ${dims.height}`')
  })
})
