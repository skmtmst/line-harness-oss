import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { globalTokens, resolveValue, sourceFiles } from '../../../scripts/card-shape-contract.mjs'

/*
 * Card の `contentPadding` は「左右別々の余白か」を文字列の見た目で決めている
 * （card.tsx の hasSides：括弧を外して空白が残るかを見る）。左右別々のときだけ
 * `data-card-spacing-sides` が付き、共通の下限 16 を外して指定どおりの余白になる
 * （card.module.css の B-208）。
 *
 * ここが食い違うと画面が壊れる。`contentPadding="var(--x)"` の 1 語で、その変数の
 * 中身が `8px 10px` のように 2 値だと、hasSides は空白を見つけられず下限側の規則に
 * 当たり `max(16px, 8px 10px)` になる。これは CSS として成り立たないので padding は
 * 初期値 0 に落ちる。枠が文字 1 行ぶんに潰れ、字が枠線に付く。
 *
 * 経緯：②アカウント接続 Step2 の「musubo の Webhook URL」の枠が、承認済み v07 の
 * 高さ 36・左右 12 ではなく細い線になって配備された（原因はこれ）。
 * 直し方は値を空白で分けて渡すこと。変数 1 語にまとめない。
 */

const WEB_SRC = path.resolve(__dirname, '../..')
const GLOBALS = path.join(WEB_SRC, 'app/globals.css')

// card.tsx の hasSides と同じ判定。片方だけ直しても意味が無いので写しで持つ。
function hasSides(value: string): boolean {
  let flat = value
  while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, '')
  return /\s/.test(flat.trim())
}

const tokens = globalTokens(readFileSync(GLOBALS, 'utf8'))

type Usage = { file: string; literal: string }

/*
 * 見るのは Card に渡した分だけ。DetailPage の同名の指定は
 * `style={{ padding: contentPadding }}`（templates/detail-page.tsx）で
 * そのまま置くので、下限 16 とも max() とも関わらない。
 */
function ownerTag(source: string, index: number): string | undefined {
  const before = source.slice(0, index)
  const opens = [...before.matchAll(/<([A-Za-z][\w.]*)/g)]
  return opens.at(-1)?.[1]
}

const usages: Usage[] = sourceFiles(WEB_SRC)
  .filter((file: string) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .flatMap((file: string) => {
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(/contentPadding="([^"]+)"/g)]
      .filter(match => ownerTag(source, match.index as number) === 'Card')
      .map(match => ({
        file: path.relative(WEB_SRC, file),
        literal: match[1] as string,
      }))
  })

describe('Card の contentPadding は hasSides が見抜ける形で渡す', () => {
  it('画面側に contentPadding の指定がある（走査が空振りしていない）', () => {
    expect(usages.length).toBeGreaterThan(0)
  })

  it('変数を解いた中身と、Card が文字列から読む判定が一致する', () => {
    const mismatched = usages
      .map(usage => ({ ...usage, resolved: resolveValue(usage.literal, tokens) as string }))
      .filter(usage => hasSides(usage.literal) !== hasSides(usage.resolved))
      .map(usage => `${usage.file}: contentPadding="${usage.literal}" は ${usage.resolved}`)
    expect(mismatched).toEqual([])
  })

  it('2値の余白変数を1語で渡さない（下限 16 と突き合わされて 0 に落ちる）', () => {
    const compound = usages
      .filter(usage => /^var\([^()]*\)$/.test(usage.literal.trim()))
      .filter(usage => hasSides(resolveValue(usage.literal, tokens) as string))
      .map(usage => `${usage.file}: ${usage.literal}`)
    expect(compound).toEqual([])
  })

  it('罠そのものは残っている（この規則に意味がある）', () => {
    // --tpl-htn-endpoint-pad は 2 値。1 語で渡すと潰れる、という前提の確認。
    expect(hasSides(resolveValue('var(--tpl-htn-endpoint-pad)', tokens) as string)).toBe(true)
    expect(hasSides('var(--tpl-htn-endpoint-pad)')).toBe(false)
  })
})
