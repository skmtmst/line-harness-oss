import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('NEN配信の差し込み欄監査', () => {
  it('NEN専用品を増やさず、シナリオ・一斉配信と同じInsertToolbarを使う', () => {
    const campaign = read('app/nen-campaigns/edit/campaign-editor.tsx')
    const scenario = read('app/scenarios/first-step/page.tsx')
    const broadcast = read('components/broadcasts/broadcast-form.tsx')
    const toolbar = read('components/scenarios/insert-toolbar.tsx')

    expect(campaign).toContain("import InsertToolbar from '@/components/scenarios/insert-toolbar'")
    expect(campaign).toContain('<InsertToolbar targetRef={bodyRef}')
    expect(scenario).toContain('<InsertToolbar targetRef={bodyRef}')
    expect(broadcast).toContain('<InsertToolbar')
    expect(toolbar).toContain('export interface InsertToolbarProps')
    expect(toolbar).not.toContain('nenCampaign')
  })
})
