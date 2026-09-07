import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CommonVar } from '@line-crm/shared'
import { describe, expect, it } from 'vitest'
import { commonVarsCsv } from './list-model'
import { impactCsv } from './impact-review'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LIST_MODEL = readFileSync(join(HERE, 'list-model.ts'), 'utf8')
const IMPACT_REVIEW = readFileSync(join(HERE, 'impact-review.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const MOCK_API = readFileSync(join(HERE, '..', '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'mock-api.mjs'), 'utf8')
const FIXTURES = readFileSync(join(HERE, '..', '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs'), 'utf8')

function item(over: Partial<CommonVar> = {}): CommonVar {
  return {
    id: 'v1', lineAccountId: 'a1', folderId: null, name: '会社名', varKey: 'company',
    type: 'text', value: '株式会社NEN', createdAt: '2026-08-01', updatedAt: '2026-08-02',
    usageCount: 3, nextSchedule: null, ...over,
  }
}

describe('#544 N7/L1 CSVの数式インジェクション対策と共通化', () => {
  it('2か所の自前csvCellをやめ、共有の無害化つき関数を使う', () => {
    expect(LIST_MODEL).toContain("from '@/lib/presentation'")
    expect(IMPACT_REVIEW).toContain("from '@/lib/presentation'")
    expect(LIST_MODEL).not.toContain('function csvCell')
    expect(IMPACT_REVIEW).not.toContain('function csvCell')
  })

  it('一覧CSVは = + - @ で始まる値を無害化する', () => {
    const csv = commonVarsCsv([item({ value: '=1+1' }), item({ id: 'v2', value: '+cmd' })])
    expect(csv).toContain("\"'=1+1\"")
    expect(csv).toContain("\"'+cmd\"")
    expect(csv).not.toMatch(/"=[^']/)
  })

  it('影響一覧CSVは差し替え後の文を無害化する', () => {
    const csv = impactCsv({
      byKind: { template: 1 },
      items: [{
        name: '予約配信', kindLabel: '一斉配信', status: '予約中', blocksDeletion: true,
        changesOnSave: true, currentPreview: '前', nextPreview: '@evil', exceedsCharacterLimit: false,
      }],
    } as never)
    expect(csv).toContain("\"'@evil\"")
  })
})

describe('#544 N1 一括削除の件数上限', () => {
  it('上限は20件で、超えたら確認口を打たず絞り込みを案内する', () => {
    expect(PAGE).toContain('const MAX_BATCH_DELETE_COUNT = 20')
    expect(PAGE).toContain('selected.size > MAX_BATCH_DELETE_COUNT')
    expect(PAGE).toContain('一度に削除できるのは')
    expect(PAGE).toContain('フォルダや検索で絞り込んで分けて削除してください')
  })
})

describe('#544 N2 一覧の件数上限と絞り込み誘導', () => {
  it('上限で切られたら黙らず、絞り込み誘導を出す', () => {
    expect(API).toContain('CommonVarsListResponse')
    expect(PAGE).toContain('vars.meta?.limited')
    expect(PAGE).toContain('表示は最初の200件までです。フォルダや検索で絞り込んでください。')
  })
})

describe('#544 N4 編集画面の値欄に入力上限を付ける', () => {
  it('値欄は200文字までで、数値種別は登録画面と同じ扱いにする', () => {
    expect(EDIT_PAGE).toMatch(/id="cv-value"[\s\S]{0,300}?maxLength=\{item\.type === 'number' \? undefined : 200\}/)
  })
})

describe('#544 N9 撮影モックに予約口を足す', () => {
  it('予約一覧・登録・削除の口と固定の予約データを用意する', () => {
    expect(FIXTURES).toContain('COMMON_VAR_SCHEDULES')
    expect(MOCK_API).toContain('COMMON_VAR_SCHEDULES')
    expect(MOCK_API).toContain('commonVarSchedules')
    expect(MOCK_API).toContain('common-vars/')
    expect(MOCK_API).toContain('/schedules')
    expect(MOCK_API).toContain('common-var-schedule-new')
  })
})
