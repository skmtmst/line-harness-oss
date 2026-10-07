import { describe, expect, it } from 'vitest'
import type { QuestionChoice } from '@/components/scenarios/question-editor'
import { choiceActionText } from './question-new'

const tags = [{ id: 't1', name: '継続' }, { id: 't2', name: 'VIP' }]
const scenarios = [{ id: 's1', name: '解約フォロー' }]
const choice = (patch: Partial<QuestionChoice>) => ({ label: 'x', behavior: 'none', ...patch }) as QuestionChoice

describe('質問を作る（l87p1J）の「押されたら」の1行', () => {
  it('タグ・シナリオは名前で、何も無ければ「何もしない」', () => {
    expect(choiceActionText(choice({ addTagIds: ['t1'] }), tags, scenarios)).toBe('タグ「継続」を付ける')
    expect(choiceActionText(choice({ addTagIds: ['t1', 't2'] }), tags, scenarios)).toBe('タグ「継続」を付ける ほか1')
    expect(choiceActionText(choice({ scenario: { op: 'start', scenarioId: 's1' } }), tags, scenarios)).toBe('シナリオ「解約フォロー」を始める')
    expect(choiceActionText(choice({ behavior: 'url', url: 'https://x' }), tags, scenarios)).toBe('URLを開く')
    expect(choiceActionText(choice({}), tags, scenarios)).toBe('何もしない')
  })
})
