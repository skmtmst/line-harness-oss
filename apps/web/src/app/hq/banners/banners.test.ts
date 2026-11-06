import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS } from '@/lib/menu'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const listPage = read('../../../v8/hq-banners/list.tsx')
const projectPage = read('../../../v8/hq-banners/project.tsx')
const panel = read('../../../components/hq/banners/generation-panel.tsx')
const modal = read('../../../v8/hq-banners/image-detail.tsx')
const banners = [listPage, projectPage, panel, modal]

/**
 * 統括のバナー生成の画面が、設計と共通ルールから外れていないかを見張る。
 * 動きの正本は `docs/hq-banner-generation.md`、見た目の正本は Pencil ★V8（`docs/v8-design-rules.md`）。
 * 行き先・タブ・権限・空・生成・やめる・参照画像は描いて押す試験が見る：
 * banners-flow-react・components/hq/banners/generation-panel-v8-react・generation-panel・reference-picker-v8・
 * image-detail-tags-v8・image-detail-modal、v8/hq-banners/list・project。
 * ここに残すのは、メニューの定義と、戻してはいけない古い形の禁止の見張りだけ。
 */
describe('統括 バナー生成', () => {
  it('統括メニューに「バナー生成」があり、行き先は /hq/banners', () => {
    const item = HQ_MENU_SECTIONS.flatMap((s) => s.items).find((i) => i.label === 'バナー生成')
    expect(item?.href).toBe('/hq/banners')
  })

  it('生成パネルに品質やクレジットの選択・生成ボタン・用途のプルダウンを戻さない（2026-09-12 決定）', () => {
    const withoutComments = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/品質|クレジット|高精細|quality/)
    expect(panel).not.toMatch(/生成する/)
    expect(panel).not.toContain('用途を選んでください')
  })

  it('詳細の窓に固定幅を書かない（1920/1160）', () => {
    expect(modal).not.toMatch(/width:\s*1160|width:\s*1920/)
  })

  it('「削除」と言わない・準備中のボタンを置かない・選べないプルダウンを出さない', () => {
    for (const source of banners) {
      expect(source).not.toMatch(/>削除</)
      expect(source).not.toMatch(/準備中/)
    }
    // 画像ライブラリの並び順は1種類しか無いので、選べないプルダウンを出さない
    expect(listPage).not.toContain('<SelectField')
  })

  it('Tailwind の任意値記法を使わない（規格外の値が普通のクラスに見える）', () => {
    for (const source of banners) {
      const arbitrary = source.match(/className="[^"]*\[[^"]*"/g) ?? []
      expect(arbitrary).toEqual([])
    }
  })
})
