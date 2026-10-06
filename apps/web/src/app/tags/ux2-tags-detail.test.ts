import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(DIR, name), 'utf8')

const TAB = read('tags-tab-v8.tsx')
const MARKS = read('marks-v8.tsx')
const SEARCHES = read('searches-v8.tsx')
const FIELDS = read('fields-tab-v8.tsx')

/*
 * UX更新 C①・D・E（タグ・友だち情報の欄のV8画面）。
 * 行を押すと右から詳細パネル（URLに残す・↑↓で前・次）。
 * 共通 DetailPanel・useDetailPanelUrl・withViewTransition を使う。
 * 自前の窓・自前の動きは作らない。
 */
describe('UXタグ2 C① 行の詳細パネル', () => {
  const cases = [
    ['tags-tab-v8.tsx', TAB, 'tag'],
    ['marks-v8.tsx', MARKS, 'mark'],
    ['searches-v8.tsx', SEARCHES, 'search'],
    ['fields-tab-v8.tsx', FIELDS, 'field'],
  ] as const
  for (const [file, src, key] of cases) {
    it(`${file}：行を押すと右のパネル（URL付き・↑↓移動）`, () => {
      expect(src).toContain('DetailPanel')
      expect(src).toContain('useDetailPanelUrl')
      expect(src).toContain(`useDetailPanelUrl('${key}')`)
      expect(src).toContain('hasPrev')
      expect(src).toContain('hasNext')
      expect(src).toContain('withViewTransition')
    })
  }

  it('タグのフォルダ入力は窓ではなく右のパネル', () => {
    expect(TAB).toContain('<DetailPanel')
    expect(TAB).not.toContain('fixed inset-0 z-50')
  })

  it('確認の窓（削除・保管）は残す', () => {
    expect(TAB).toContain('ConfirmDialog')
    expect(TAB).toContain('DeleteTagDialog')
    expect(MARKS).toContain('ArchiveMarkDialog')
    expect(SEARCHES).toContain('ConfirmDialog')
    expect(FIELDS).toContain('ConfirmDialog')
  })
})

/*
 * C②：名前など1項目の変更はその場の書き換え（共通 InlineEdit）。
 * 口（API）がある操作だけ。タグ名に単独の更新口は無いので付けない。
 */
describe('UXタグ2 C② その場の書き換え', () => {
  it('マーク・検索・項目の名前はその場で直せる', () => {
    for (const src of [MARKS, SEARCHES, FIELDS]) {
      expect(src).toContain('InlineEdit')
      expect(src).toContain('onSave')
    }
  })

  it('タグ名に単独の更新口は無いのでその場書き換えは付けない', () => {
    // api.tags.update は星だけ。無い口は作らず、編集画面へ行く。
    expect(TAB).not.toContain('InlineEdit')
    expect(TAB).toContain('/tags/edit?id=')
  })
})

/*
 * C③：右クリックでも「…」と同じメニュー（共通 ContextMenu）。
 */
describe('UXタグ2 C③ 右クリックメニュー', () => {
  it('4画面とも行の「…」と同じ操作を右クリックで出せる', () => {
    expect(TAB).toContain('tagContextItems')
    expect(MARKS).toContain('markContextItems')
    expect(SEARCHES).toContain('searchContextItems')
    expect(FIELDS).toContain('fieldContextItems')
    for (const src of [TAB, MARKS, SEARCHES, FIELDS]) {
      expect(src).toContain('<ContextMenu')
      expect(src).toContain('ActionMenu')
    }
  })
})
