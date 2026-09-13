import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const APP = path.join(__dirname)
const source = (relativePath: string) => fs.readFileSync(path.join(APP, relativePath), 'utf8')

const pages = [
  'reminders/edit/page.tsx',
  'notifications/page.tsx',
  'search-console/page.tsx',
  'pools/page.tsx',
]

describe('機能7・20・24・33の本文上部', () => {
  it.each(pages)('%s は旧Headerを描かない', (relativePath) => {
    const page = source(relativePath)
    expect(page).not.toContain("from '@/components/layout/header'")
    expect(page).not.toContain('<Header')
  })

  it('未対応インボックスの画面名はトップバーへ渡す', () => {
    expect(source('notifications/page.tsx')).toContain("usePageTitle('未対応インボックス')")
  })

  it('Search Consoleの操作は分析タブの後に残す', () => {
    const page = source('search-console/page.tsx')
    expect(page.indexOf('<MergedTabs')).toBeLessThan(page.indexOf('data-design="Head"'))
    expect(page).toContain('CSVで書き出す')
    expect(page).toContain('連携を設定')
  })
})
