import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('NEN配信の差し込み欄監査', () => {
  it('NEN専用品を増やさず、シナリオ・一斉配信と同じInsertToolbarを使う', () => {
    const campaign = read('app/nen-campaigns/edit/campaign-editor-v8.tsx')
    const scenario = read('app/scenarios/first-step/page.tsx')
    const broadcast = read('components/broadcasts/broadcast-form.tsx')
    const composer = read('components/shared/message-composer.tsx')
    const toolbar = read('components/scenarios/insert-toolbar.tsx')

    expect(campaign).toContain("import InsertToolbar from '@/components/scenarios/insert-toolbar'")
    expect(campaign).toContain('<InsertToolbar targetRef={bodyRef}')
    expect(scenario).toContain('<InsertToolbar targetRef={bodyRef}')
    // 一斉配信は共通のメッセージ作成（G-9）を通して同じ InsertToolbar を使う。
    expect(broadcast).toContain('<MessageComposer')
    expect(composer).toContain('<InsertToolbar')
    expect(toolbar).toContain('export interface InsertToolbarProps')
    expect(toolbar).not.toContain('nenCampaign')
  })
})
