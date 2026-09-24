import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 日本語の文節改行（`auto-phrase`）と見出しの行揃え（`balance`）は、
 * 画面側のクラスに負ける強さで置く。
 *
 * 層の外に書いていたときは Tailwind の utilities 層より強く、
 *   - `truncate` の見出し（ダッシュボードのカード名など6か所）が折り返し
 *   - `break-all`（URL・秘密値を途中で折る、27ファイル）が効かなかった
 * （2026-09-23 の点検で発覚）。
 */

const GLOBALS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'globals.css'), 'utf8')
const withoutComments = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')

function baseLayers(css: string): string {
  const blocks: string[] = []
  const re = /@layer base\s*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(css))) {
    let depth = 1
    let i = match.index + match[0].length
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth += 1
      if (css[i] === '}') depth -= 1
      i += 1
    }
    blocks.push(css.slice(match.index, i))
  }
  return blocks.join('\n')
}

describe('日本語の改行は画面側のクラスに負ける強さで置く', () => {
  const base = baseLayers(withoutComments)
  const outside = base.split('\n@layer base').reduce((rest, block, index) => rest.replace(index === 0 ? block : `@layer base${block}`, ''), withoutComments)

  it('auto-phrase と見出しの balance は @layer base の中にある', () => {
    expect(base).toMatch(/:lang\(ja\)\s*\{\s*word-break:\s*auto-phrase;/)
    expect(base).toMatch(/h3\s*\{\s*text-wrap:\s*balance;/)
  })

  it('層の外には書かない（truncate・break-all を上書きしてしまう）', () => {
    expect(outside).not.toMatch(/word-break:\s*auto-phrase/)
    expect(outside).not.toMatch(/text-wrap:\s*balance/)
  })
})
