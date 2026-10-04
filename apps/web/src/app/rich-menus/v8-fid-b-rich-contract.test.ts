import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const CREATE = readFileSync(join(HERE, 'new', 'create-v8.tsx'), 'utf8')
const HISTORY = readFileSync(join(HERE, 'edit', 'publish-history.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')

/**
 * fid-b-rich（B）：板の印と板どおりの呼び方。
 * 絵が正本。印が無いと数に入らないので、手順・権限で印を分ける。
 */
describe('一覧の板印（rZEGN／ZoKow）', () => {
  it('操作できる一覧は rZEGN、閲覧のみは ZoKow', () => {
    expect(LIST).toContain("data-design-node={canEdit ? 'rZEGN' : 'ZoKow'}")
  })
  it('閲覧のみのとき注意書きを見せる', () => {
    expect(LIST).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
  })
})

describe('作成の板印（JeINq／OxEMM）', () => {
  it('手順①に JeINq、手順③に OxEMM', () => {
    expect(CREATE).toContain('data-design-node="JeINq"')
    expect(CREATE).toContain('data-design-node="OxEMM"')
  })
})

describe('公開の板どおりの呼び方（hKr8f）', () => {
  it('照合は「もう一度照らし合わせる」', () => {
    expect(HISTORY).toContain('もう一度照らし合わせる')
    expect(HISTORY).not.toContain('LINEとのずれを確認')
  })
  it('切替のつながりをいまの状態と一緒に出す', () => {
    expect(EDIT).toContain('切替のつながり')
    expect(EDIT).toContain('いまの状態')
  })
})
