import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LEGACY = readFileSync(join(HERE, '..', 'scoring', 'page.tsx'), 'utf8')
const LEGACY_NEW = readFileSync(join(HERE, '..', 'scoring', 'new', 'page.tsx'), 'utf8')
const NEW_RULE = readFileSync(join(HERE, 'earning-rules', 'new', 'page.tsx'), 'utf8')
const MENU = readFileSync(join(HERE, '..', '..', 'lib', 'menu.ts'), 'utf8')

describe('V6 マイルの正本URLと概念分離', () => {
  it('マイルの正本を /mileage にし、旧URLを恒久転送する', () => {
    expect(MENU).toContain("{ href: '/mileage', label: 'マイル'")
    expect(LEGACY).toContain("permanentRedirect('/mileage')")
    expect(LEGACY_NEW).toContain("permanentRedirect('/mileage/earning-rules/new')")
  })

  it('本文タイトルを重ねず、実装済み2タブだけを出す', () => {
    expect(PAGE).toContain('data-mileage-design="v6"')
    expect(PAGE).toContain("{ key: 'balances', label: '友だちの残高' }")
    expect(PAGE).toContain("{ key: 'earning-rules', label: 'たまる決めごと' }")
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('準備中')
  })

  it('残高は共通トップバーで選んだLINEアカウントだけを取得する', () => {
    expect(PAGE).toContain('selectedAccountId')
    expect(PAGE).toContain('accountId: accountAtRequest')
    expect(PAGE).toContain('accountAtRequest !== latestAccountRef.current')
    expect(PAGE).not.toContain('<option value="all">全アカウント横断</option>')
  })

  it('作成画面も mileage_rules のAPIと正本URLを使う', () => {
    expect(NEW_RULE).toContain('api.mileage.createRule')
    expect(NEW_RULE).toContain("parent={['マイル', '/mileage?tab=earning-rules']}")
    expect(NEW_RULE).not.toContain('api.scoring.create')
  })
})
