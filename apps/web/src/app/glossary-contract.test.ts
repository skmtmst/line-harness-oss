import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

/** 画面のコードを、`.test.` を除いて集める。 */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

/**
 * 注釈と、機械が読む値を落とす。
 *
 * 見張りたいのは**画面に出る言葉**だけ。
 * 「なぜ『対応済』をやめたか」を書いた注釈が自分の見張りに当たると、
 * 直したのに落ちるという嘘の失敗になる。
 * `resolved` のような API の値も画面には出ないので対象外。
 */
function visible(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FILES = sources(SRC).map((p) => ({ p: path.relative(SRC, p), s: visible(fs.readFileSync(p, 'utf8')) }))

/** `docs/v6-requirements/v6-00-glossary.md` の1〜2節。使うほうを左に書く。 */
const BANNED: Array<{ use: string; avoid: RegExp; why: string }> = [
  { use: 'すべて', avoid: /全て/, why: '要件書が93対5で「すべて」' },
  { use: '対応済み', avoid: /対応済(?!み)/, why: '未対応・対応中・保留と語尾をそろえる' },
  { use: '友だち', avoid: /友達/, why: '要件書467か所すべて「友だち」' },
  { use: '絞り込み', avoid: /絞込/, why: '名詞を圧縮しない' },
  { use: '未割り当て', avoid: /未割当(?!て)/, why: '同上' },
  { use: 'アカウント', avoid: /アカ(?![ウ])/, why: '省略語を開く' },
]

describe('用語表（V6 §7 48番の表記ゆれ潰し）', () => {
  for (const { use, avoid, why } of BANNED) {
    it(`画面には「${use}」を出す（${why}）`, () => {
      const hits = FILES.filter((f) => avoid.test(f.s)).map((f) => f.p)
      expect(hits, `「${use}」に直す: ${hits.join(', ')}`).toEqual([])
    })
  }

  it('対応状況の4つは、要件書と同じ順に並べる', () => {
    const inbox = FILES.find((f) => f.p === 'components/chats/inbox-filter-panel.tsx')
    expect(inbox).toBeDefined()
    const order = [...inbox!.s.matchAll(/label: '(未対応|対応中|保留|対応済み)'/g)].map((m) => m[1])
    expect(order, 'v6-02-inbox-requirements-draft.md:188 の順').toEqual(['未対応', '対応中', '保留', '対応済み'])
  })
})
