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
    for (const name of ['radius-v6-option', 'radius-v6-control', 'radius-v6-card', 'radius-v6-dialog']) {
      expect(design.has(token(name)), `${name} が設計に無い値`).toBe(true)
    }
  })

  it('設計の7段がすべてトークンとして存在する', () => {
    // 設計: xxs3 / xs6 / sm8 / md10 / panel12 / lg18 / full9999
    expect(token('radius-tiny')).toBe('3px')
    expect(token('radius-mini')).toBe('6px')
    expect(token('radius-control')).toBe('0.5rem') // 8px
    expect(token('radius-tile')).toBe('10px')
    expect(token('radius-panel')).toBe('12px')
    expect(token('radius-v6-large')).toBe('18px') // 既存の rounded-lg へ波及させない専用名
    expect(token('radius-pill')).toBe('9999px')
  })

  it('V6の18pxをTailwind既定の rounded-lg へ流し込まない', () => {
    // `--radius-lg` をここで定義すると、V6専用の2箇所だけでなく
    // 既存の `rounded-lg` 利用先85ファイルが8pxから18pxへ変わる。
    expect(CSS).not.toMatch(/--radius-lg:\s*18px/)
    expect(token('radius-v6-large')).toBe('18px')
  })

  /*
   * **どのNodeの何を測ったかまで書く。**
   * 「設計に◯◯pxがある」は「この class が◯◯px」ではない。
   * 一度それで共通ボタンを36→38に変えかけた（ボタンは置き場所で
   * 36/38/40 の3段階あり、共通ボタンの正本 `Ai3fq` は36で実装と一致）。
   */
  it('V6の角丸を、その class を貼っている場所の正本Nodeへ固定する', () => {
    // sMpET「表示項目 基本情報」h=46 $radius-sm。使用1箇所も同じ行。
    expect(token('radius-v6-option')).toBe('8px')
    // Gfsb4「プルダウン開状態」$radius-sm。注記の正本(案内バー)も同値。
    expect(token('radius-v6-control')).toBe('8px')
    // pRHvc「検索と絞り込み」/ k4Hz0X「友だち一覧カード」/ eHPwj「一括操作バー」= $radius-md
    expect(token('radius-v6-card')).toBe('10px')
    // z7O873「友だち 詳細検索モーダル」w=760 h=936 $radius-panel
    expect(token('radius-v6-dialog')).toBe('12px')
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
  it('共通ボタンは Ai3fq の 36px・角丸8px・13px・600 に合わせる', () => {
    expect(BUTTON).toMatch(/height:\s*36px/)
    expect(BUTTON).toMatch(/padding:\s*9px 13px/)
    expect(BUTTON).toMatch(/border-radius:\s*var\(--radius-control\)/)
    expect(token('radius-control')).toBe('0.5rem') // = 8px
    expect(BUTTON).toMatch(/font-size:\s*var\(--text-label\)/)
    expect(BUTTON).toMatch(/font-weight:\s*600/)
  })
})
