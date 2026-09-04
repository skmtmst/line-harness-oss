import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('テンプレート一覧のV6画面構造', () => {
  const page = read('page.tsx')
  const panel = read('../../components/shared/folder-panel.tsx')
  const detail = read('detail/page.tsx')
  const assetManager = read('../../components/broadcasts/broadcast-asset-manager.tsx')
  const styles = read('templates-v6.module.css')

  it('W7LBcどおり本文タイトルと補足を置かず、タイトルは共通トップバーに任せる', () => {
    expect(page).not.toContain("import Header from '@/components/layout/header'")
    expect(page).not.toContain('<Header')
    expect(page).not.toContain('配信で使うメッセージを管理します。')
    expect(assetManager).not.toContain('<h2')
    expect(assetManager).not.toContain('{meta.description}')
  })

  it('種別切替はW7LBcの44px下線タブを共通部品で描く', () => {
    expect(page).toContain("import { Tabs } from '@/components/shared/tabs'")
    expect(page).toContain('data-design-node="W7LBc kcmGB"')
    expect(page).toContain('<Tabs')
    expect(page).not.toContain('rounded-2xl border border-slate-200 bg-canvas p-2')
    for (const label of ['メッセージ', 'カルーセル', 'リッチメッセージ', 'クーポン', 'リサーチ']) {
      expect(page).toContain(`label: '${label}'`)
    }
  })

  it('作成操作はV6のFuBeQへ置き、行き先の分かる名前にする', () => {
    expect(page).toContain('data-design-node="W7LBc FuBeQ"')
    expect(page).toContain('テンプレートを作る')
    expect(page).not.toContain('+ 新規テンプレート')
    expect(assetManager).toContain('data-design-node="FuBeQ"')
    expect(assetManager).toContain('{meta.singular}を作る')
  })

  it('W7LBcどおりKPIを挟まず、252pxのフォルダ列と一覧列を横に並べる', () => {
    expect(page).not.toContain("import ListKpis from '@/components/shared/list-kpis'")
    expect(page).not.toContain('<ListKpis')
    expect(styles).toContain('width: 252px')
    expect(styles).toContain('flex: 0 0 252px')
    // 2026-09-04: 自前で描いていた帯を共通 `FolderPanel` へ寄せた。
    // 読み上げ名は部品が持つ（`aria-label="フォルダ"`）。
    expect(page).toContain('<FolderPanel')
    expect(panel).toContain('aria-label="フォルダ"')
    expect(page).toContain('className="min-w-0 flex-1"')
  })

  it('参照中は強制削除せず、使用先を確認させる', () => {
    expect(page).toContain('使用先を見る')
    expect(page).toContain('使用先を差し替えてから削除してください。')
    expect(page).not.toContain('削除すると参照がクリアされます')
    for (const usage of ['scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks']) {
      expect(page).toContain(usage)
    }
    expect(detail).toContain('disabled={usageCount > 0}')
    expect(detail).toContain('使用中のため削除できません')
    expect(detail).not.toContain('削除すると、その箇所の本文が空になります')
  })

  it('M9cijの削除確認を共通ダイアログで表示し、ブラウザ標準確認へ戻さない', () => {
    expect(page).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(detail).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(page).toContain('data-design-node="M9cij"')
    expect(detail).toContain('data-design-node="M9cij"')
    expect(page).toContain('open={pendingDelete !== null}')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toContain("confirm('このテンプレートを削除しますか？')")
  })

  it('詳細もタイトルを本文へ重ねず、データ由来の名前をトップバーへ渡す', () => {
    expect(detail).toContain('usePageTitle(template?.name ?? null)')
    expect(detail).not.toContain("import Header from '@/components/layout/header'")
    expect(detail).not.toContain('本文と、このテンプレートがどこで使われているかを確認できます。')
    expect(detail).not.toContain('複製は準備中です')
    expect(detail).toContain('テンプレートを編集')
  })
})
