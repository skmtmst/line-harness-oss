/*
 * 送信後アクションの窓（設計 `V6 5 hz9ti 送信後のアクションを設定`）の契約。
 *
 * いちばん効くのは**段の並び**。追加口が一覧の後ろにあると、1つも無いときに
 * 何をすればいいのかが画面の一番下にしか無く、空の枠を見て手が止まる。
 * 並びは見た目の好みではないので、ここで固定する。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(path.join(__dirname, 'action-editor.tsx'), 'utf8')
/*
 * 設計固有の実寸はCSSモジュールへ置いてある。任意値記法で散らすと
 * `design-debt` の数が増え、どれが設計の数かも区別できなくなる。
 */
const CSS = fs.readFileSync(path.join(__dirname, 'action-editor.module.css'), 'utf8')

describe('V6 送信後アクションの契約', () => {
  it('見出しと説明を設計の言葉にする', () => {
    expect(EDITOR).toContain('送信後のアクションを設定')
    expect(EDITOR).not.toContain('>アクション設定<')
    expect(EDITOR).toContain('に実行する動作を決めます。上から順に実行します。')
  })

  it('「追加する動作を選ぶ」を「実行する動作」より先に置く', () => {
    const chooser = EDITOR.indexOf('追加する動作を選ぶ</h3>')
    const list = EDITOR.indexOf('実行する動作（上から順に実行）</h3>')
    expect(chooser).toBeGreaterThan(-1)
    expect(list).toBeGreaterThan(-1)
    expect(chooser).toBeLessThan(list)
  })

  it('後ろに置いていた古い追加口を残さない', () => {
    expect(EDITOR).not.toContain('動作を更に追加できます')
    expect(EDITOR).not.toContain('下から選んで追加してください')
  })

  it('動作の札は設計の寸法（h58・r8・12/700・アイコン18）で並べる', () => {
    expect(CSS).toMatch(/\.kindButton \{[^}]*height: 58px;[^}]*border-radius: 8px;/)
    expect(EDITOR).toContain('styles.kindButton')
    expect(EDITOR).toContain('text-caption font-bold')
    expect(EDITOR).toContain('size={18}')
  })

  it('実行順は26pxの丸番号で出し、行は72pxを下限にする', () => {
    expect(CSS).toMatch(/\.orderMark \{[^}]*height: 26px;[^}]*width: 26px;/)
    expect(CSS).toMatch(/\.actionRow \{[^}]*min-height: 72px;/)
    expect(EDITOR).toContain('styles.orderMark')
    expect(EDITOR).toContain('rounded-pill')
    expect(EDITOR).toContain('styles.actionRow')
  })

  it('窓の幅と見出しの大きさを設計に合わせる', () => {
    expect(CSS).toMatch(/\.dialog \{[^}]*max-width: 1240px;/)
    expect(EDITOR).toContain('styles.dialog')
    expect(EDITOR).not.toContain('max-w-4xl')
    expect(EDITOR).toContain('text-title font-bold')
  })

  it('設計Node IDを画面に残す', () => {
    expect(EDITOR).toContain('data-design-node="hz9ti"')
  })

  it('読込中の言葉を決まりにそろえる', () => {
    expect(EDITOR).toContain('読み込んでいます')
    expect(EDITOR).not.toContain('読み込み中…')
  })

  /*
   * 設計はセクションに1つだが、`repeatOnRefire` は動作1件ごとの列。
   * 1つにまとめると動作ごとに違う値を持てず、既にある設定を黙って
   * 上書きすることになる。動作ごとのまま残す。
   */
  it('「発動2回目以降も実行する」は動作ごとに置いたままにする', () => {
    expect(EDITOR).toContain('checked={action.repeatOnRefire}')
    expect(EDITOR).toContain('発動2回目以降も実行する')
  })

  /*
   * 設計は8つ、実装が持つ種別は5つ。作れない札を3つ増やしても
   * できることは増えない（押しても何も起きない札になる）。
   */
  it('作れる動作だけを並べる', () => {
    const kinds = EDITOR.slice(
      EDITOR.indexOf('export const ACTION_KINDS'),
      EDITOR.indexOf('const KIND_LABEL'),
    )
    expect(kinds.match(/type: '/g)).toHaveLength(5)
  })
})
