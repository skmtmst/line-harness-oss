import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

/**
 * **画面名を、本文とトップバーで2回出さない。**
 *
 * 設計（`docs/design-reference/scenarios-v6/TC1b1.txt`）で「シナリオ配信」が
 * 出るのは 2 回だけ——サイドメニューと、トップバー。**本文には 0 回**で、
 * 設計の本文は注意帯から始まる。
 *
 * 実装は本文にも題を出していたので、同じ言葉が画面に 2 回見えていた。
 * `PageHeader` を使う 9 画面すべてと、`<h1>` を直に書いた画面が該当する。
 *
 * ただし**一律に隠すのではない。** 詳細画面（`bV5Vs` シナリオ編集）は、
 * トップバーがその記録の名前「新規登録7日間フォロー」を出し、本文でも
 * パンくずの下に同じ名前を出す——**設計そのものが2回出している。**
 * 重なるのは「トップバーと本文が同じ言葉のとき」だけなので、`PageHeader`
 * はトップバーが何を出しているかを見て、同じときだけ隠す。
 *
 * ## 2回出す道は2つしかない
 *
 * 1. `page.tsx` が `<h1>` を直接書く
 * 2. `PageHeader` に `titleDisplay="always"` を渡す
 *
 * **両方を塞げば、二重表示は 0 になる。** ここはその2つを見張る。
 *
 * `<h1>` そのものを禁じているわけではない。`PageHeader` は `sr-only` で
 * 持っている——消すと読み上げで「この画面は何か」を辿れなくなり、
 * 見出しの階層も h2 から始まってしまう。
 */

/** 画面のコードを、`.test.` を除いて集める。 */
function pages(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) pages(p, out)
    else if (e.name === 'page.tsx') out.push(p)
  }
  return out
}

/** 注釈を落とす。**「なぜ h1 をやめたか」を書いた注釈が自分の見張りに当たらないように。** */
function visible(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const PAGES = pages(path.join(SRC, 'app')).map((p) => ({
  p: path.relative(SRC, p).split(path.sep).join('/'),
  s: visible(fs.readFileSync(p, 'utf8')),
}))

/**
 * **本文に `<h1>` を持ってよい画面。理由を書く。**
 *
 * どれも「トップバーが出す画面名と同じ言葉を、本文でもう一度出す」形では
 * ない。増やすときは、その画面のトップバーに何が出ているかを見てから。
 */
const ALLOWED_H1: Record<string, string> = {
  // トップバーが無い。`<h1>` がその画面の唯一の見出し。
  'app/login/page.tsx': 'ログインはトップバーの外',
  'app/login/two-factor/page.tsx': 'ログインはトップバーの外',
  // 出しているのはテナント名（「株式会社 然」）で、画面名ではない。
  // 画面名の「統括コンソール」は、その上に小さく出る別の行。
  'app/hq/page.tsx': '出しているのはテナント名',
  'app/hq/open/page.tsx': '出しているのはテナント名',
  // 画面名ではなく読み物の見出し（「購入後も、LINEで丁寧につながる」）。
  'app/nen-campaigns/page.tsx': '読み物の見出し',
  // 消す予定の画面。docs/v6-directives.md §4「/updates を /emergency へ
  // 一本化」「V2/V3 の検証島を消す」。触らない。
  'app/updates/page.tsx': '消す予定（/emergency へ一本化）',
  'app/visual-qa/friend-attributes/page.tsx': '消す予定（V2/V3 の検証島）',
}

describe('画面名を本文とトップバーで2回出さない', () => {
  it('全ページを読めている', () => {
    expect(PAGES.length).toBe(131)  // 2026-09-04: 自動応答の公開（`auto-replies/publish`）が入って 131。
  })

  it('page.tsx が h1 を直接持たない', () => {
    const found = PAGES.filter((f) => /<h1[\s>]/.test(f.s)).map((f) => f.p).sort()
    expect(found, '本文に h1 を書いた画面が増えた。PageHeader へ寄せる').toEqual(
      Object.keys(ALLOWED_H1).sort(),
    )
  })

  it('題を必ず出す画面を増やさない', () => {
    // `titleDisplay="always"` はトップバーの外に置く画面のためだけにある。
    const found = PAGES.filter((f) => /titleDisplay/.test(f.s)).map((f) => f.p)
    expect(found, 'PageHeader の題を必ず出している画面がある').toEqual([])
  })

  it('PageHeader は、トップバーと同じ言葉のときだけ題を隠す', () => {
    const header = fs.readFileSync(path.join(SRC, 'components', 'shared', 'page-header.tsx'), 'utf8')
    // 既定は auto。トップバーが出す題と見比べて決める。
    expect(header).toMatch(/titleDisplay\s*=\s*'auto'/)
    expect(header).toContain('defaultTitleForPath')
    expect(header).toMatch(/barTitle !== title/)
    expect(header).toMatch(/shown \? styles\.title : 'sr-only'/)
  })
})
