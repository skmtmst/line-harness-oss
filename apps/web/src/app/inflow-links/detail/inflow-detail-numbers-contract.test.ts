import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
// 削除の窓は v7・V8 の両方で使う共用部品へ移した（中身は同じ）。
// 削除の窓は詳細の画面（detail/page.tsx）の中にある。古い _components/inflow-delete-dialog.tsx はどこからも描かれないので 2026-10-07 に消した。
const DIALOG = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * V6 流入リンク詳細の数字の契約（#514 重大3）。
 *
 * 口から取れない数を定数で書いていた（残り78人・ブロック8人・今月240回・
 * 1人あたり¥1,493・既定名・18人）。取れない数は出さない。未取得は「—」。
 */
describe('V6 流入リンク詳細の数字の契約', () => {
  it('口から取れない定数を書かない', () => {
    expect(PAGE).not.toContain('value={78}')
    expect(PAGE).not.toContain('今月 240回')
    expect(PAGE).not.toContain('1人あたり ¥1,493')
    expect(PAGE).not.toContain('体験前フォロー')
    expect(PAGE).not.toContain("'Instagram'")
    // R269: 口にマイル付与の欄は無い。設計見本の固定値（#531 で残していた）を
    // 実動作として出さない。V6 の文言固定より使いやすさが勝つ（2026-09-25）。
    expect(PAGE).not.toContain('マイルを 100 付ける')
    expect(PAGE).not.toContain('18人います')
    expect(PAGE).not.toContain('ブロック率 9.3%')
  })

  it('取れない段は「—」+理由か、設定の有無で言い分ける', () => {
    expect(PAGE).toContain('割合は集計できません')
    expect(PAGE).toContain('集計を取得できていません')
    expect(PAGE).toContain('取得できません')
    expect(PAGE).toContain('動きが未設定')
  })

  it('記号入り ref でも URL を壊さない', () => {
    expect(PAGE).toContain('encodeURIComponent(route.refCode)')
    expect(DIALOG).toContain('encodeURIComponent(redirectTarget.refCode)')
  })
})
