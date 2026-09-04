import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const WEB = path.join(__dirname, '..', '..')
const CSS = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8')
const BUTTON = fs.readFileSync(path.join(WEB, 'src', 'components', 'shared', 'button.module.css'), 'utf8')

function token(name: string): string {
  const hit = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return hit ? hit[1].trim() : '(未定義)'
}

/**
 * **値が同じでも、名前を分けたままにするもの。**
 *
 * ここに載るのは「いまたまたま同じ値だが、役割が別なので片方だけ
 * 変わりうる」もの。名前を1本にすると、変えたい側だけを変えられなくなる。
 * **増やすときは理由を書く。**
 */
const ALLOWED_SAME_VALUE = [
  // アクセントの淡色と、成功状態の地。globals.css の冒頭が
  // 「アクセントを状態表示に使わない」と決めている。値を分けるかは
  // 設計（Pencil）の判断なので、実装側で名前を畳まない。
  '--color-accent-soft / --color-success-bg',
  // 色の上に乗る文字（白）と、面そのもの（白）。地の色が変われば
  // 乗る文字は黒へ変わるので、同じ名前にはできない。
  '--color-on-accent / --color-on-action / --color-canvas',
]

/**
 * Pencil の `pencil-new.pen` を実測した値。
 *
 * **画像を目で見比べても数pxの差は出ない。** 設計から数を取り出して
 * ここに固定し、実装がずれたら落ちるようにする。
 * 測り方は `Get(<nodeId>, visit, {depth: 8})` で `width` `height`
 * `fontSize` `fontWeight` `cornerRadius` を読む。
 */
describe('設計の実測値に合わせる', () => {
  it('文字の段は設計の10段と一致する', () => {
    // Pencil: $size-nano..$size-display
    expect(token('text-nano')).toBe('10px')
    expect(token('text-micro')).toBe('11px')
    expect(token('text-caption')).toBe('12px')
    expect(token('text-label')).toBe('13px')
    expect(token('text-body')).toBe('14px')
    expect(token('text-lead')).toBe('16px')
    expect(token('text-heading')).toBe('18px')
    expect(token('text-title')).toBe('20px')
    expect(token('text-metric')).toBe('22px')
    expect(token('text-display')).toBe('30px')
  })

  it('角丸は設計にある値だけを使う', () => {
    // 設計の角丸は 3 / 6 / 8 / 10 / 12 / 18 / 9999 の7段しかない。
    const design = new Set(['3px', '6px', '8px', '10px', '12px', '18px', '9999px'])
    for (const name of ['radius-control', 'radius-control', 'radius-card', 'radius-panel']) {
      expect(design.has(token(name)), `${name} が設計に無い値`).toBe(true)
    }
  })

  it('設計の7段がすべてトークンとして存在する', () => {
    // 設計: xxs3 / xs6 / sm8 / md10 / panel12 / lg18 / full9999
    expect(token('radius-icon')).toBe('3px')
    expect(token('radius-mini')).toBe('6px')
    expect(token('radius-control')).toBe('8px')
    expect(token('radius-card')).toBe('10px')
    expect(token('radius-panel')).toBe('12px')
    expect(token('radius-large')).toBe('18px') // 既存の rounded-lg へ波及させない専用名
    expect(token('radius-pill')).toBe('9999px')
  })

  it('V6の18pxをTailwind既定の rounded-lg へ流し込まない', () => {
    // `--radius-lg` をここで定義すると、V6専用の2箇所だけでなく
    // 既存の `rounded-lg` 利用先85ファイルが8pxから18pxへ変わる。
    expect(CSS).not.toMatch(/--radius-lg:\s*18px/)
    expect(token('radius-large')).toBe('18px')
  })

  /*
   * **どのNodeの何を測ったかまで書く。**
   * 「設計に◯◯pxがある」は「この class が◯◯px」ではない。
   * 一度それで共通ボタンを36→38に変えかけた（ボタンは置き場所で
   * 36/38/40 の3段階あり、共通ボタンの正本 `Ai3fq` は36で実装と一致）。
   */
  it('V6の角丸を、その class を貼っている場所の正本Nodeへ固定する', () => {
    // sMpET「表示項目 基本情報」h=46 $radius-sm。使用1箇所も同じ行。
    expect(token('radius-control')).toBe('8px')
    // Gfsb4「プルダウン開状態」$radius-sm。注記の正本(案内バー)も同値。
    expect(token('radius-control')).toBe('8px')
    // pRHvc「検索と絞り込み」/ k4Hz0X「友だち一覧カード」/ eHPwj「一括操作バー」= $radius-md
    expect(token('radius-card')).toBe('10px')
    // z7O873「友だち 詳細検索モーダル」w=760 h=936 $radius-panel
    expect(token('radius-panel')).toBe('12px')
  })

  /*
   * **共通ボタンは36pxで正しい。**
   *
   * 設計に38pxのボタンもあるが、それは別の部品——画面ヘッダーの操作
   * （`PhxG6` h=38 r=$radius-md）、確認モーダルの操作（`J6x4Q` w=112 h=38
   * r=$radius-sm 12/700）、ページ送り（`Blot6` h=38）。共通ボタンの正本は
   * `Ai3fq`（共通 編集追従バー）で、そちらは 36 / $radius-sm / [9,13] /
   * $size-label / 600 と、実装に一致する。
   *
   * 一度この2つを混同して36→38に変えかけた。**「設計に38pxがある」は
   * 「共通ボタンが38px」ではない。** どのNodeの何を測ったかまで見る。
   */
  /*
   * **同じ値のトークンを2つ持たない。**
   *
   * 以前は色が3系統あった——緑が2色（`--color-accent` #06c755 と
   * `--color-v6-accent` #07c653）、赤が3色（#b3261e / #d34851 / #e5484d）、
   * 角丸は 10px に3つ、8px に3つ、3px に2つの名前が付いていた。
   *
   * **同じ値に名前が2つあると、片方だけ直した画面が出る。** 実際
   * `--color-v6-ink-faint`(#8b938d) は白地で 3.16:1 しか無く、AA に
   * 届かないまま10画面に残っていた。共通側の `--color-ink-faint`
   * (#6e7781) だけが直っていて、V6 名を使う画面には効かなかった。
   *
   * 比べるのは**同じ役割の系統の中だけ**。`--radius-card`(10px) と
   * `--text-nano`(10px) は数が同じでも別の物差しで、片方を変えても
   * もう片方は動かない。
   */
  it('同じ系統の中に、同じ値のトークンを2つ置かない', () => {
    const theme = CSS.slice(CSS.indexOf('@theme {'), CSS.indexOf('\n}\n', CSS.indexOf('@theme {')))
    const tokens = [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*--([a-z0-9]+)-([a-z0-9-]+):\s*([^;]+);/gm)]
    const byFamily = new Map<string, Map<string, string[]>>()
    for (const [, family, rest, raw] of tokens) {
      const value = raw.trim().toLowerCase()
      if (!byFamily.has(family)) byFamily.set(family, new Map())
      const bucket = byFamily.get(family)!
      if (!bucket.has(value)) bucket.set(value, [])
      bucket.get(value)!.push(`--${family}-${rest}`)
    }
    const found = new Set<string>()
    for (const bucket of byFamily.values())
      for (const names of bucket.values()) if (names.length > 1) found.add(names.join(' / '))
    expect([...found].sort(), '同じ値のトークンが増えた。名前を1本にするか、値を分ける').toEqual(
      [...ALLOWED_SAME_VALUE].sort(),
    )
  })

  it('V6 の別系統トークンを残さない', () => {
    // `--color-v6-*` `--radius-v6-*` `--shadow-v6-*` は 1 系統へ畳んだ。
    const theme = CSS.slice(CSS.indexOf('@theme {'), CSS.indexOf('\n}\n', CSS.indexOf('@theme {')))
    const left = [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*(--[a-z0-9-]*-v6-[a-z0-9-]+):/gm)].map((m) => m[1])
    expect(left, 'V6 専用の別名トークンが戻っている').toEqual([])
  })

  /*
   * **主ボタンは `$accent-deep`(#087a3e) + 白文字。**
   *
   * LINE の緑 `$accent`(#06c755) に白文字を乗せると 2.26:1 しか無い。
   * ラベルは 13px なので AA の 4.5:1 に届かない。`$accent-deep` は 5.44:1。
   * **新しい色は作らない**——Pencil のトークン表にある色だけを使う
   * （決定 2026-09-03、正本は要件索引 §5-2）。
   *
   * `$accent` は消さない。選択状態・チップ・有効表示に残す。
   */
  it('主ボタンは accent-deep の地に白文字を乗せる', () => {
    expect(token('color-accent-deep')).toBe('#087a3e')
    expect(token('color-on-accent')).toBe('#ffffff')
    expect(BUTTON).toMatch(/\.primary\s*\{[^}]*background:\s*var\(--color-accent-deep\)/s)
    expect(BUTTON).toMatch(/\.primary\s*\{[^}]*color:\s*var\(--color-on-accent\)/s)
    // LINE の緑は残す（文字が乗らない用途で使う）
    expect(token('color-accent')).toBe('#06c755')
  })

  it('共通ボタンは Ai3fq の 36px・角丸8px・13px・600 に合わせる', () => {
    expect(BUTTON).toMatch(/height:\s*36px/)
    expect(BUTTON).toMatch(/padding:\s*9px 13px/)
    expect(BUTTON).toMatch(/border-radius:\s*var\(--radius-control\)/)
    expect(token('radius-control')).toBe('8px')
    expect(BUTTON).toMatch(/font-size:\s*var\(--text-label\)/)
    expect(BUTTON).toMatch(/font-weight:\s*600/)
  })
})
