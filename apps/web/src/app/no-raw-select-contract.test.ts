import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

/**
 * **素の `<select>` を画面に書かない。**
 *
 * プルダウンの共通部品は1つ（`shared/select.tsx` の `Select`）。
 * 開いた形まで自分で描くため、開状態の設計（`Gfsb4`）も絵に写る。
 * 旧 `SelectField`（ブラウザ標準の包み）は 2026-09-26 に Select へ
 * 統一し、削除した。
 *
 * 画面ごとに `<select>` を書くと、**高さ・枠・角丸がそのつどずれる。**
 * 実測で 41 画面・83 か所あり、`h-9` `h-10` `py-2` が混ざっていた。
 *
 * ここは「素で書かない」だけを見張る。
 */

function pages(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) pages(p, out)
    else if (e.name === 'page.tsx') out.push(p)
  }
  return out
}

const PAGES = pages(path.join(SRC, 'app')).map((p) => ({
  p: path.relative(path.join(SRC, 'app'), p).split(path.sep).join('/'),
  s: fs.readFileSync(p, 'utf8'),
}))

const count = (s: string) => (s.match(/<select[\s>]/g) ?? []).length

/**
 * **まだ素で書いている画面。減る一方の表。**
 *
 * 寄せるのは画面ごとの作業で、担当は S1〜S3（`docs/v6-parallel-plan.md`
 * §4「守ること」で S0 は機能の画面を触らない）。ここは**増やせないこと**
 * だけを見張る。0 になったら行ごと消す——消し忘れるとこの試験が落ちる。
 *
 * 2026-09-04 に 41 画面・83 か所すべてを共通部品へ寄せ終えた。
 * 空の表を残し、今後も素の要素を画面へ戻せないように見張る。
 */
const NOT_YET: Record<string, number> = {}

describe('素の <select> を画面に書かない', () => {
  it('全ページを読めている', () => {
    expect(PAGES.length).toBe(189)  // 情報欄の編集画面と運営専用ナレッジ（37-11）、★V7見本（v7-progress-filedrop・v7-combobox・v7-target-missing）、設定の中のファイルの検査を含む実測値。2026-09-25 に比較用 /tags-v2・/tags-v3 の2画面を撤去。2026-09-28 にイベントの変更の確認・お客様表示の確認の2画面を追加（U）。同日に付与ルールの下書き編集画面を追加（R296）。
  })

  it('表に無い画面は素の <select> を持たない', () => {
    const found = PAGES.filter((f) => !(f.p in NOT_YET) && count(f.s) > 0).map((f) => f.p)
    expect(found, '画面に素の <select> が入った。Select を使う').toEqual([])
  })

  it('表にある画面でも増やさない', () => {
    for (const f of PAGES) {
      const allowed = NOT_YET[f.p]
      if (allowed === undefined) continue
      expect(count(f.s), `${f.p} の素の <select> が ${allowed} か所から増えた`).toBeLessThanOrEqual(allowed)
    }
  })

  it('0 になった画面は表から消す', () => {
    for (const p of Object.keys(NOT_YET)) {
      const f = PAGES.find((x) => x.p === p)
      expect(f, `${p} が無い。表から消す`).toBeDefined()
      expect(count(f!.s), `${p} は 0 か所になった。表から行を消す`).toBeGreaterThan(0)
    }
  })

  it('消した SelectField を呼び戻さない', () => {
    // 旧 `SelectField` は 2026-09-26 に Select へ統一し、部品ごと消した。
    // 取り込みで古い枝が戻すと型検査が落ちる。呼び出しの復活を見張る。
    const sources = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) sources(p, out)
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
      }
      return out
    }
    const self = path.relative(SRC, __filename).split(path.sep).join('/')
    const revived = sources(SRC)
      .filter((p) => {
        const rel = path.relative(SRC, p).split(path.sep).join('/')
        return rel !== self && fs.readFileSync(p, 'utf8').includes('shared/select-field')
      })
      .map((p) => path.relative(SRC, p).split(path.sep).join('/'))
    expect(revived, '消した SelectField の呼び出しが戻った。Select を使う').toEqual([])
  })

  it('共通部品は素の <select> を持たない', () => {
    // 例外は1つだけ。「ブラウザ標準を使う」ことに理由がある。
    const shared = fs.readdirSync(path.join(SRC, 'components', 'shared'))
      .filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))
    const withRaw = shared.filter((n) =>
      count(fs.readFileSync(path.join(SRC, 'components', 'shared', n), 'utf8')) > 0)
    expect(withRaw.sort(), '共通部品に素の <select> が入った').toEqual([
      // アカウントの札。印を `select` の中に置けないので札へ重ね、
      // `select` は透明にして上に敷く。開いた中身はブラウザ任せのまま。
      'top-bar.tsx',
    ])
  })
})
