import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../../v8/automations/create/create.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, '../../../components/shared/action-list.module.css'), 'utf8')

/*
 * #973 U023: 自動化の新規作成（/automations/new）で
 * 「すること」と「付けるタグ」などの対象設定が2列のまま潰れていた。
 */
describe('自動化作成のはみ出し（#973 U023）', () => {
  it('共通の処理の行は狭い幅で折り返し、設定は縦に並ぶ', () => {
    expect(PAGE).toContain('<ActionList<ActionDraft>')
    expect(CSS).toContain('@media (max-width: 600px)')
    expect(CSS).toContain('.row { flex-wrap: wrap; }')
    expect(CSS).toContain('.editor { display: flex; flex-direction: column;')
    expect(CSS).toContain('.title, .titleButton { flex-basis: 100%; order: 1; }')
  })

  it('固定最小幅の2列（190px+260px）は390pxを通らないので持たない', () => {
    expect(CSS).not.toContain('minmax(190px')
    expect(CSS).not.toContain('minmax(260px, 1.2fr)')
  })
})
