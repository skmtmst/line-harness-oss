import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS } from '@/lib/menu'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const listPage = read('./page.tsx')
const projectPage = read('./project/page.tsx')
const panel = read('../../../components/hq/banners/generation-panel.tsx')
const modal = read('../../../components/hq/banners/image-detail-modal.tsx')
const projects = read('../../../components/hq/banners/projects-section.tsx')
const library = read('../../../components/hq/banners/library-section.tsx')
const shell = read('../../../components/hq/banners/banner-shell.tsx')
const banners = [listPage, projectPage, panel, modal, projects, library, shell, read('../../../components/hq/banners/image-tile.tsx'), read('../../../components/hq/banners/project-card.tsx')]

/**
 * ★V6 35 系（バナー生成）の画面が、設計と共通ルールから外れていないかを見張る。
 * 正本は Pencil `V6正本.pen` と `docs/v6-requirements/v6-35-banner-generation-requirements-draft.md`。
 */
describe('統括 バナー生成', () => {
  it('統括メニューに「バナー生成」があり、行き先は /hq/banners', () => {
    const item = HQ_MENU_SECTIONS.flatMap((s) => s.items).find((i) => i.label === 'バナー生成')
    expect(item?.href).toBe('/hq/banners')
  })

  it('詳細はクエリ（?id=）で表し、動的セグメントを作らない', () => {
    expect(projects).toContain('/hq/banners/project?id=')
    expect(library).toContain('/hq/banners/project?id=')
    expect(projectPage).toContain("params.get('id')")
  })

  it('タブは ?tab= で切り替え、履歴を積まない（replace）', () => {
    expect(listPage).toContain("params.get('tab') === 'library'")
    expect(listPage).toContain("router.replace(next === 'library' ? '/hq/banners?tab=library' : '/hq/banners')")
    expect(shell).not.toMatch(/href:\s*'\/hq\/banners/)
  })

  it('画面名はトップバーだけに出し、本文に見出しを置かない', () => {
    expect(listPage).toContain("usePageTitle('バナー生成')")
    expect(projectPage).toContain('usePageTitle(project?.name ?? null)')
    expect(listPage).not.toContain('<Header')
    expect(projectPage).not.toContain('<Header')
  })

  it('L 一覧型の帯の順: タブ行 → 数値カード帯 → 案内帯 → 一覧本体', () => {
    const order = ['<BannerTabs', '<BannerKpis', '<BannerNote', '<ProjectsSection']
    const positions = order.map((needle) => listPage.indexOf(needle))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('生成パネルに品質やクレジットの選択を置かない（2026-09-12 決定）', () => {
    const withoutComments = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/品質|クレジット|高精細|quality/)
    for (const label of ['用途', '画像に入れるテキスト', 'メインカラー', 'サブカラー', '人物', '追加の指示', '枚数']) {
      expect(panel).toContain(label)
    }
  })

  it('生成は「条件を登録 → 1枚ずつ run」を繰り返し、失敗したら止めて理由を出す', () => {
    expect(projectPage).toContain('api.hqBanners.projects.createGeneration(')
    expect(projectPage).toContain('api.hqBanners.generations.run(current.id)')
    expect(projectPage).toContain('if (res.data.finished) break')
    expect(projectPage).toContain('setGenerationError(message)')
    expect(projectPage).toContain('api.hqBanners.generations.cancel(running.id)')
    // 画面を離れて戻ったとき、途中の生成があれば続きから動かす
    expect(projectPage).toContain('activeGeneration(generations)')
  })

  it('保存・実行は下部追従バーにしか置かない', () => {
    expect(projectPage).toContain('<StickyBar')
    expect(projectPage).toContain('生成する（{input.count}枚）')
    expect(projectPage).toContain('残りをやめる')
    expect(projectPage).toContain('条件をクリア')
    expect(panel).not.toMatch(/生成する/)
  })

  it('モーダルは全面1枚のオーバーレイで、幅は max-width（1920/1160 の固定幅を書かない）', () => {
    expect(modal).toContain('fixed inset-0')
    expect(modal).toContain('bg-scrim')
    expect(modal).toContain('maxWidth: 1160')
    expect(modal).not.toMatch(/width:\s*1160|width:\s*1920/)
    expect(modal).toContain('useOverlayFocus')
  })

  it('店舗へ渡すは、渡し済みの店舗を灰色にして二度渡さない', () => {
    expect(modal).toContain('delivered.has(account.id)')
    expect(modal).toContain('disabled={already || busy}')
    expect(modal).toContain('渡し済み')
    expect(modal).toContain('店舗へ渡す')
  })

  it('「削除」ではなく「一覧から外す」「アーカイブ」と言う', () => {
    for (const source of banners) {
      expect(source).not.toMatch(/>削除</)
    }
    expect(modal).toContain('一覧から外す')
    expect(projectPage).toContain('アーカイブする')
  })

  it('空・読込中・失敗・権限不足は共通の ListState で出す', () => {
    for (const source of [projects, library, projectPage]) {
      expect(source).toContain('kind="loading"')
      expect(source).toContain('kind="error"')
      expect(source).toContain('kind="forbidden"')
      expect(source).toContain('kind="empty"')
    }
    expect(projects).toContain('まだプロジェクトがありません')
    expect(projects).toContain('最初のプロジェクトを作る')
  })

  it('使えない操作を置かない（準備中のボタンが無い）', () => {
    for (const source of banners) {
      expect(source).not.toMatch(/準備中/)
    }
    // 画像ライブラリの並び順は1種類しか無いので、選べないプルダウンを出さない
    expect(library).not.toContain('<SelectField')
  })

  it('Tailwind の任意値記法を使わない（規格外の値が普通のクラスに見える）', () => {
    for (const source of banners) {
      const arbitrary = source.match(/className="[^"]*\[[^"]*"/g) ?? []
      expect(arbitrary).toEqual([])
    }
  })
})
