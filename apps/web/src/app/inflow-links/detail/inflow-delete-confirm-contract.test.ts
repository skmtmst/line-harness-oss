import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
describe('V6 流入リンクの削除確認 UIaM7', () => {
  it('ブラウザ標準の確認ではなく画面内ダイアログを使う', () => {
    expect(PAGE).not.toMatch(/\b(?:window\.)?confirm\s*\(/)
    expect(PAGE).toContain('data-design-node="UIaM7"')
    expect(PAGE).toContain('role="dialog"')
  })

  it('影響を示して停止・転送・削除の3つから選べる', () => {
    expect(PAGE).toContain('「{route.name}」を削除しますか？')
    expect(PAGE).toContain('新しい人を受けるのをやめる（おすすめ）')
    expect(PAGE).toContain('別の流入リンクへ送るようにする')
    expect(PAGE).toContain('このまま削除する')
    expect(PAGE).toContain('付いたタグ・進んでいるシナリオは消えません')
  })

  it('APIの成否を見て、失敗時は窓を閉じず画面の言葉を出す', () => {
    expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
    expect(PAGE).toContain(
      '選んだ処理を完了できませんでした。状態を読み直してから、もう一度お試しください。',
    )
    expect(PAGE).toContain('if (!route || deleting) return')
  })

  it('転送先は利用者に選ばせ、先頭の自動採用をしない (#514 重大4)', () => {
    expect(PAGE).toContain('inflow-redirect-target')
    expect(PAGE).toContain('転送先のリンクを選んでください')
    expect(PAGE).toContain('redirectTargetId')
    expect(PAGE).not.toContain('routes.find((candidate) => candidate.id !== route.id)')
  })
})
