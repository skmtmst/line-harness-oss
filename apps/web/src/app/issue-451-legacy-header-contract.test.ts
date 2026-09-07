import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const app = path.join(__dirname)
const read = (relativePath: string) => fs.readFileSync(path.join(app, relativePath), 'utf8')

const targets = [
  'nen-campaigns/page.tsx',
  'nen-campaigns/edit/page.tsx',
  'webhooks/page.tsx',
  'tags/edit/page.tsx',
  'auto-replies/page.tsx',
  'broadcasts/detail/page.tsx',
]

describe('Issue #451 V6画面名はトップバーだけに置く', () => {
  it.each(targets)('%s に旧Headerを残さない', (relativePath) => {
    const source = read(relativePath)
    expect(source).not.toContain("import Header from '@/components/layout/header'")
    expect(source).not.toContain('<Header')
  })

  it('NEN配信の操作をパンくずとタブより上の画面先頭へ置く', () => {
    const page = read('nen-campaigns/page.tsx')
    const overview = read('nen-campaigns/nen-overview.tsx')
    expect(page).toContain('topAction={headerAction}')
    expect(overview.indexOf('data-design="Crumb"')).toBeLessThan(overview.indexOf('<Tabs'))
  })

  it('外部連携の操作をパンくずへ、自動応答の作成操作をKPI直下へ置く', () => {
    const webhooks = read('webhooks/page.tsx')
    const autoReplies = read('auto-replies/page.tsx')
    expect(webhooks.indexOf('data-design="Crumb"')).toBeLessThan(webhooks.indexOf('<MergedTabs'))
    expect(autoReplies.indexOf('data-design="KPIs"')).toBeLessThan(autoReplies.indexOf('data-design="Actions"'))
    expect(autoReplies).toContain('ルールを作成')
  })

  it('一斉配信詳細のCSV操作を下部追従バーへ置く', () => {
    const source = read('broadcasts/detail/page.tsx')
    expect(source).toContain('<StickyBar')
    expect(source.indexOf('<StickyBar')).toBeLessThan(source.lastIndexOf('CSVで書き出す'))
  })
})
