import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * #648: globals.css にレイヤー外で書かれた
 *   :lang(ja) { word-break: auto-phrase }
 *   h1,h2,h3 { text-wrap: balance }
 * が Tailwind v4 の @layer utilities を常に上回り、全画面の
 * `truncate`（white-space: nowrap）と `break-all` を無効化していた。
 * 見出しが折り返して固定高カードからはみ出す事故になった。
 *
 * この試験は、改行・折り返しを支配する要素セレクタの既定値ルールが
 * レイヤー外に書かれたら落ちる。レイヤー内（base）ならユーティリティが勝つ。
 */

const globals = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')

/** コメントを取り除き、ネストした { } を考慮して @layer ... { ... } ブロックも取り除く。 */
function stripLayerBlocks(css: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let out = bare
  const re = /@layer[^{]*\{/g
  let m: RegExpExecArray | null
  const spans: Array<[number, number]> = []
  while ((m = re.exec(bare))) {
    let depth = 1
    let i = re.lastIndex
    while (i < bare.length && depth > 0) {
      if (bare[i] === '{') depth++
      else if (bare[i] === '}') depth--
      i++
    }
    spans.push([m.index, i])
  }
  for (const [s, e] of spans.reverse()) out = out.slice(0, s) + out.slice(e)
  return out
}

describe('レイヤー外ルールがユーティリティを殺さない（#648）', () => {
  const outside = stripLayerBlocks(globals)

  it('折り返し系の既定値は @layer 内にだけ置く', () => {
    /*
     * text-wrap は white-space と text-wrap-mode を共有するショートハンド。
     * レイヤー外の text-wrap/word-break は truncate・break-all 系を全滅させる。
     */
    expect(outside).not.toMatch(/[^-]text-wrap\s*:/)
    expect(outside).not.toMatch(/word-break\s*:/)
    expect(outside).not.toMatch(/white-space\s*:/)
    expect(outside).not.toMatch(/overflow-wrap\s*:/)
  })

  it('改行ルール自体は base レイヤーに残っている（意図の維持）', () => {
    expect(globals).toMatch(/@layer\s+base\s*{[^}]*:lang\(ja\)\s*{\s*word-break:\s*auto-phrase/s)
    expect(globals).toMatch(/text-wrap:\s*balance/)
  })
})
