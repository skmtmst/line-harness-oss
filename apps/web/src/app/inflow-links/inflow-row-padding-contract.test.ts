import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 流入と計測の一覧と板 `xbHxg` の数値突き合わせ（2026-10-03）。
 * 表の行は余白 9/20。見出し・数の帯・探す欄は共通部品（M10）の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const tsx = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('流入と計測の一覧の行は板 xbHxg の余白どおり', () => {
  it('行のセルは左右 20・上下 9', () => {
    const tbody = tsx.slice(tsx.indexOf('<tbody'), tsx.indexOf('</tbody>'))
    // 選択欄と操作欄を除くデータセル。文字列・テンプレート文字列の両方を見る。
    const cells = [...tbody.matchAll(/<td className=(?:"([^"\n]*)"|\{`([^`\n]*)`\})/g)]
      .map((match) => match[1] ?? match[2])
      .filter((classes) => !classes.includes('pl-5') && !classes.includes('text-right'))
    expect(cells).toHaveLength(8)
    for (const classes of cells) {
      expect(classes).toContain('px-5 py-[9px]')
      expect(classes).not.toContain('px-2 py-3')
    }
  })
})
