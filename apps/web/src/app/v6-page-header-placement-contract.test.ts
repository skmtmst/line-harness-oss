import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(join(HERE, relative), 'utf8')

const pages = [
  ['duplicates/page.tsx', "usePageTitle('重複検出')"],
  ['users/page.tsx', "usePageTitle('統合ユーザー')"],
  ['friends/detail/page.tsx', "usePageTitle('友だち詳細')"],
  ['templates/edit/page.tsx', "usePageTitle(id ? 'メッセージを編集' : 'メッセージを作る')"],
  ['templates/carousel/page.tsx', "usePageTitle(id ? 'カルーセルの編集' : 'カルーセルを作る')"],
  ['rich-menus/edit/page.tsx', "editorStep === 'publish' ? '公開のしかた' : 'メニューを作る'"],
  ['form-submissions/edit/page.tsx', "usePageTitle(name || '回答フォーム編集')"],
] as const

describe('Issue #452: V6の画面名は共通トップバーだけに置く', () => {
  it.each(pages)('%s は旧Headerを使わず画面名をトップバーへ渡す', (relative, pageTitle) => {
    const source = read(relative)
    expect(source).not.toContain("from '@/components/layout/header'")
    expect(source).not.toContain('<Header')
    expect(source).toContain(pageTitle)
  })

  it('友だち詳細はパンくずの隣に設計どおりの3操作を残す', () => {
    const source = read('friends/detail/page.tsx')
    const start = source.indexOf('data-design="Crumb"')
    const end = source.indexOf('{error &&', start)
    const top = source.slice(start, end)
    for (const label of ['受信箱で開く', '個別操作', 'その他の操作']) {
      expect(top).toContain(label)
    }
    expect(top).not.toContain('非表示')
    expect(top).not.toContain('ブロック')
  })

  it('作成画面は設計上端のSTEPとタブを残す', () => {
    expect(read('rich-menus/edit/page.tsx')).toContain('<StepHeader active={1}')
    const form = read('form-submissions/edit/page.tsx')
    for (const label of ['フォーム編集', 'デザイン設定', 'オプション設定']) {
      expect(form).toContain(label)
    }
  })
})
