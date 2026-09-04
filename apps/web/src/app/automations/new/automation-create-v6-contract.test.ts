import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ルールを作る（★V6 `Rv8Jv`）の見張り。
 *
 * 見ているのは3つ。
 *
 *   1. 画面名を本文へ戻さないこと（トップバー・パンくず・h1 の三重を消した）
 *   2. 設計の寸法（番号バッジ26・主要ボタン40/8/13/700・入力40・本文120・右390）
 *   3. **選べるきっかけが、実際に発火するものだけであること**
 *
 * 3つめだけは、この画面のソースを読むだけでは確かめられない。発火するかは
 * `apps/worker` の `fireEvent` 呼び出し元が決めるので、そちらを読んで突き合わせる。
 * 画面側の一覧だけを見る試験にすると、また「保存はできるが一度も動かない」
 * 選択肢が増えたときに気づけない。
 */

const HERE = import.meta.dirname
const REPO = join(HERE, '..', '..', '..', '..', '..', '..')
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
/**
 * 注釈を落とした本文。
 *
 * 「準備中を出さない」のような**やらない決めごとは注釈にも書く**ので、
 * 生のソースを見ると自分の注釈に当たる。画面に出る文字だけを見る。
 */
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const CSS = readFileSync(join(HERE, 'new-automation.module.css'), 'utf8')
const TYPES = readFileSync(join(REPO, 'packages', 'shared', 'src', 'types.ts'), 'utf8')

/** 画面が並べているきっかけの値。 */
function screenEventValues(): string[] {
  const block = /const EVENTS[\s\S]*?\n\]\n/.exec(PAGE)
  if (!block) throw new Error('EVENTS の定義が読めません')
  return [...block[0].matchAll(/value: '([^']+)'/g)].map((m) => m[1])
}

/** `AutomationEventType` が許している値。 */
function allowedEventTypes(): string[] {
  const block = /export type AutomationEventType =([\s\S]*?);/.exec(TYPES)
  if (!block) throw new Error('AutomationEventType が読めません')
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * `fireEvent(..., '<値>'` を worker 側から探す。
 *
 * 引数の1つめはDBの持ち方で `db` だったり `c.env.DB` だったりする。
 * どちらでも当たるようにする。
 */
function firedEventTypes(): Set<string> {
  const root = join(REPO, 'apps', 'worker', 'src')
  const fired = new Set<string>()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    const source = readFileSync(join(entry.parentPath ?? root, entry.name), 'utf8')
    for (const m of source.matchAll(/fireEvent\([^,]*, '([^']+)'/g)) fired.add(m[1])
  }
  return fired
}

describe('V6 ルールを作る（Rv8Jv）', () => {
  it('画面名は共通トップバーにだけ置く', () => {
    expect(PAGE).toContain("usePageTitle('ルールを作る')")
    expect(PAGE).toContain('data-design-node="Rv8Jv"')
    // 本文の見出しとサブタイトルを戻さない。パンくずとトップバーで足りる。
    expect(PAGE).not.toContain('<h1')
    expect(PAGE).not.toContain("from '@/components/shared/page-header'")
    expect(PAGE).not.toContain("from '@/components/shared/create-page'")
  })

  it('保存・キャンセルは下部追従バーにしか置かない', () => {
    expect(PAGE).toContain("import StickyBar from '@/components/shared/sticky-bar'")
    const bar = PAGE.slice(PAGE.indexOf('<StickyBar'))
    for (const label of ['キャンセル', '保存して続けて作る']) {
      expect(bar, `${label} が追従バーの外にあります`).toContain(label)
    }
    // 追従バーより前に保存の押し口を置かない。
    expect(PAGE.slice(0, PAGE.indexOf('<StickyBar'))).not.toContain('保存中...')
  })

  it('設計の寸法を持つ', () => {
    // 番号バッジ 26×26・丸・12px（$size-caption）・700
    expect(CSS).toMatch(/\.stepBadge\s*\{[^}]*width: 26px;/)
    expect(CSS).toMatch(/\.stepBadge\s*\{[^}]*height: 26px;/)
    expect(CSS).toMatch(/\.stepBadge\s*\{[^}]*border-radius: var\(--radius-pill\);/)
    expect(CSS).toMatch(/\.stepBadge\s*\{[^}]*font-size: var\(--text-caption\);/)
    expect(CSS).toMatch(/\.stepBadge\s*\{[^}]*font-weight: 700;/)

    // 主要ボタン 高さ40 / 角丸8 / 余白[0,14] / 13px / 700
    expect(CSS).toMatch(/\.action\s*\{[^}]*height: 40px;/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*border-radius: var\(--radius-control\);/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*padding: 0 14px;/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*font-size: var\(--text-label\);/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*font-weight: 700;/)

    // 「動きを追加」だけ高さ44、行の中の小さな操作は 32 / r6
    expect(CSS).toMatch(/\.addAction\s*\{[^}]*height: 44px;/)
    expect(CSS).toMatch(/\.rowAction\s*\{[^}]*height: 32px;/)
    expect(CSS).toMatch(/\.rowAction\s*\{[^}]*border-radius: var\(--radius-mini\);/)

    // プルダウン 高さ40 / 角丸8 / 13px
    expect(CSS).toMatch(/\.select\s*\{[^}]*height: 40px;/)
    expect(CSS).toMatch(/\.select\s*\{[^}]*border-radius: var\(--radius-control\);/)
    expect(CSS).toMatch(/\.select\s*\{[^}]*font-size: var\(--text-label\);/)

    // カード r10（$radius-md = --radius-card）／カード内のまとまり r8
    expect(CSS).toMatch(/\.card\s*\{[^}]*border-radius: var\(--radius-card\);/)
    expect(CSS).toMatch(/\.group\s*\{[^}]*border-radius: var\(--radius-control\);/)

    // 右カラム 390px、本文入力 120px
    expect(CSS).toContain('grid-template-columns: minmax(0, 1fr) 390px;')
    expect(CSS).toMatch(/\.textareaTall\s*\{[^}]*min-height: 120px;/)
  })

  it('1行入力は共通部品（高さ40）を使う', () => {
    expect(PAGE).toContain("import { TextArea, TextField } from '@/components/shared/text-field'")
    const field = readFileSync(
      join(REPO, 'apps', 'web', 'src', 'components', 'shared', 'text-field.module.css'),
      'utf8',
    )
    expect(field).toContain('height: 40px;')
  })

  it('右カラムに固有カード・つながる先・気をつけることを置く', () => {
    expect(PAGE).toContain('data-design="Right"')
    expect(PAGE).toContain("import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'")
    expect(PAGE).toContain('当てはまりそうな人数')
  })

  it('取れない数は未接続の言葉で出し、0件と書かない', () => {
    expect(PAGE).toContain(
      'まだ繋がっていません。見込み人数を数える口が接続されると表示されます。',
    )
    // 見込み人数の枠に 0 を書かない。
    expect(PAGE).not.toContain('見込み人数: 0')
    expect(PAGE).not.toContain('0人が当てはまります')
  })

  it('権限が無いときは保存を押せない形にし、理由を本文へ出す', () => {
    expect(PAGE).toContain("return '操作する権限がありません'")
    expect(PAGE).toContain('操作する権限がありません。オーナーか管理者に依頼してください。')
    expect(PAGE).toContain('disabled={saving || Boolean(blockedReason)}')
    expect(PAGE).toContain('if (saving || blockedReason) return')
  })

  it('読み込み中と読み込めなかったときを言い分ける', () => {
    expect(PAGE).toContain('読み込んでいます')
    expect(PAGE).toContain('タグを読み込めませんでした。画面を再読み込みしてください。')
    // 読めていないのに空の選択肢だけを出さない。
    expect(PAGE).toContain('disabled={tagsLoading || tagsFailed}')
  })

  it('選べるきっかけが AutomationEventType に収まっている', () => {
    const allowed = allowedEventTypes()
    expect(allowed.length).toBeGreaterThan(0)
    const values = screenEventValues()
    expect(values.length).toBeGreaterThan(0)
    expect(values.filter((v) => !allowed.includes(v))).toEqual([])
  })

  it('選べるきっかけが、実際に発火するものだけである', () => {
    const fired = firedEventTypes()
    // 取り違えて空集合になったら、この試験は何も見なくなる。
    expect(fired.size).toBeGreaterThan(2)
    const values = screenEventValues()
    expect(
      values.filter((v) => !fired.has(v)),
      '発火する呼び出しが apps/worker にないきっかけを画面へ出しています',
    ).toEqual([])
  })

  it('一度も動かない旧きっかけを戻さない', () => {
    for (const dead of ['friend_added', 'tag_added', 'form_submitted', 'link_clicked']) {
      expect(PAGE, `${dead} は発火しません`).not.toContain(`'${dead}'`)
    }
    expect(PAGE_CODE).not.toContain('準備中')
  })

  it('すること（動き）を複数持てる', () => {
    expect(PAGE).toContain('動きを追加')
    expect(PAGE).toContain('この動きを消す')
    expect(PAGE).toContain('actions: actions.map(')
    // 1つしか送らない形へ戻さない。
    expect(PAGE).not.toContain('actions: [\n')
  })
})
