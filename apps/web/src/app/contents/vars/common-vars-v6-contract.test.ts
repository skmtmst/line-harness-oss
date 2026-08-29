import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(HERE, 'new', 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const WORKER = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'worker', 'src', 'routes', 'contents.ts'), 'utf8')

describe('V6共通情報一覧', () => {
  it('WuKzUどおり画面名は共通トップバーだけに置く', () => {
    expect(PAGE).toContain('data-design-node="WuKzU"')
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('マニュアルは準備中です')
    expect(PAGE).not.toContain('並び替えは準備中です')
    expect(NEW_PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(NEW_PAGE).not.toContain('<Header')
    expect(EDIT_PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(EDIT_PAGE).not.toContain('<Header')
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
    expect(PAGE).toContain('api.commonVars.deleteImpact(id, selectedAccountId)')
    expect(WORKER).toContain("code: 'COMMON_VAR_IN_USE'")
    expect(WORKER).toContain('getCommonVarUsageImpact')
  })

  it('値を変えると保存前にuNBlAの影響一覧で変更前後を確認する', () => {
    expect(API).toContain('impactPreview:')
    expect(EDIT_PAGE).toContain('api.commonVars.impactPreview(item.id, accountAtRequest, value)')
    expect(EDIT_PAGE).toContain('data-design-node="uNBlA"')
    expect(EDIT_PAGE).toContain('currentPreview')
    expect(EDIT_PAGE).toContain('nextPreview')
    expect(EDIT_PAGE).toContain('この内容で保存する')
    expect(EDIT_PAGE).toContain('value === item.value')
    expect(EDIT_PAGE).toContain('影響する場所を確認できませんでした。もう一度お試しください。')
  })

  it('所属を確認できない回答フォームは中身を見せず安全側に止める', () => {
    expect(EDIT_PAGE).toContain('impact.unscopedFormTotal')
    expect(EDIT_PAGE).toContain('内容を見せず、安全のため影響件数に含めています')
    expect(WORKER).toContain('unscopedFormTotal: impact.unscopedFormTotal')
  })

  it('選択中のLINEアカウントをすべての共通情報APIへ渡す', () => {
    expect(PAGE).toContain('api.commonVars.list(accountAtRequest)')
    expect(PAGE).toContain('latestAccountRef.current')
    expect(API).toContain('accountId=${encodeURIComponent(accountId)}')
    expect(WORKER).toContain("c.req.query('accountId')")
    expect(WORKER).toContain('canAccessAllLineAccounts')
  })
})
