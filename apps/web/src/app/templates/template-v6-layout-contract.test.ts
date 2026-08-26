import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('テンプレート一覧のV6画面構造', () => {
  const page = read('page.tsx')
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
    expect(page).toContain('aria-label="テンプレートのフォルダ"')
    expect(page).toContain('className="min-w-0 flex-1"')
  })
})
