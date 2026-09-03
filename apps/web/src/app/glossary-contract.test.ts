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

  /**
   * **固定の4状態と、自由分類のマークは別物。**
   *
   * 要件書 `v6-02-inbox-requirements-draft.md:77`
   *   「V6画面の『対応マーク』は、実装時に『対応状況』へ変更する。
   *     友だち属性の対応マークは右パネル内の別項目として表示する。」
   *
   * 見分け方は API の形。`chatStatus` / `status` が
   * unread・in_progress・on_hold・resolved を取るものは**対応状況**。
   * `support_mark` / `markId` を扱うものが**対応マーク**。
   */
  it('固定4状態を「対応マーク」と呼ばない', () => {
    const FIXED_STATE = [
      'app/chats/page.tsx',
      'app/friends/detail/page.tsx',
      'components/chats/inbox-dropdown.tsx',
      'components/chats/inbox-filter-panel.tsx',
      'components/chats/friend-info-sidebar.tsx',
      'components/friends/single-friend-actions.tsx',
      'components/friends/advanced-search-dialog.tsx',
      'components/dashboard/side-cards.tsx',
      'components/dashboard/dashboard-editor.tsx',
    ]
    for (const rel of FIXED_STATE) {
      const f = FILES.find((x) => x.p === rel)
      expect(f, `${rel} が見つからない`).toBeDefined()
      // side-cards は「自動変更する対応マークがあるか」を読むので、その一語だけ許す。
      const body = rel === 'components/dashboard/side-cards.tsx'
        ? f!.s.replace(/対応マーク一覧/g, '')
        : f!.s
      expect(body.includes('対応マーク'), `${rel}: 固定4状態は「対応状況」と呼ぶ`).toBe(false)
    }
  })

  /**
   * **期間の言い方を1つにする。**
   *
   * 同じ30日を「直近30日」「過去30日」「この30日」の3通りで書いていた。
   * `/analytics` は1つの画面の中で「直近30日」と「この30日」が混ざっていた。
   * 設計は60回が「この30日」なので、そちらへ寄せる。
   *
   * **28日は別の話。** `/conversions` とダッシュボードは本当に28日で
   * 数えている（`conversions/page.tsx:44`）。言い方をそろえる前に、
   * どの窓が正しいかを決める必要があるので、ここでは見張らない。
   */
  it('30日の窓は「この30日」と書く', () => {
    const hits = FILES.filter((f) => /直近30日|過去30日/.test(f.s)).map((f) => f.p)
    expect(hits, '「この30日」に寄せる').toEqual([])
  })

  /**
   * **LINEの見た目を確かめる面の札を1つにする。**
   *
   * 実装は5通りに割れていた——LINEプレビュー／LINEカードプレビュー／
   * LINE配信プレビュー／配信プレビュー／〜のプレビュー。
   * 設計は30枚すべて「LINEプレビュー」。
   *
   * `プレビューを隠す` `プレビューのみ` のような、面そのものを指さない語は
   * 対象外なので、`LINE` か `配信` が付いた形だけを見る。
   */
  it('LINEの見た目を出す面は「LINEプレビュー」と呼ぶ', () => {
    const hits = FILES.filter((f) => /LINEカードプレビュー|LINE配信プレビュー|配信プレビュー/.test(f.s)).map((f) => f.p)
    expect(hits, '「LINEプレビュー」に寄せる').toEqual([])
  })

  it('同じものを「対応状態」とも呼ばない', () => {
    const hits = FILES.filter((f) => f.s.includes('対応状態')).map((f) => f.p)
    expect(hits, '「対応状況」に寄せる').toEqual([])
  })

  it('対応状況の4つは、要件書と同じ順に並べる', () => {
    const inbox = FILES.find((f) => f.p === 'components/chats/inbox-filter-panel.tsx')
    expect(inbox).toBeDefined()
    const order = [...inbox!.s.matchAll(/label: '(未対応|対応中|保留|対応済み)'/g)].map((m) => m[1])
    expect(order, 'v6-02-inbox-requirements-draft.md:188 の順').toEqual(['未対応', '対応中', '保留', '対応済み'])
  })
})
