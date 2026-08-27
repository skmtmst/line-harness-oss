import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const WORKER = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'worker', 'src', 'routes', 'contents.ts'), 'utf8')

describe('V6共通情報一覧', () => {
  it('WuKzUどおり画面名は共通トップバーだけに置く', () => {
    expect(PAGE).toContain('data-design-node="WuKzU"')
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('並び替えは準備中です')
  })

  it('次回予約は一覧APIで受け取り、行ごとのAPI呼出をしない', () => {
    expect(PAGE).toContain('item.nextSchedule')
    expect(PAGE).not.toContain('api.commonVars.schedules(item.id)')
  })

  it('初回空と検索0件を言い分ける', () => {
    expect(PAGE).toContain('まだ共通情報がありません')
    expect(PAGE).toContain('条件に合う共通情報はありません')
    expect(PAGE).toContain('共通情報を作る')
  })

  it('削除前に使用先を確認し、API側も使用中の削除を止める', () => {
    expect(API).toContain('deleteImpact:')
    expect(PAGE).toContain('api.commonVars.deleteImpact(id)')
    expect(WORKER).toContain("code: 'COMMON_VAR_IN_USE'")
    expect(WORKER).toContain('getCommonVarUsageImpact')
  })
})
