import { describe, expect, it } from 'vitest'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import { hasStoredDestination, summarizeFormDestinations } from './form-destination-summary'

describe('summarizeFormDestinations', () => {
  it('フォームが書き換える情報欄とタグを重複なく数える', () => {
    const layout = emptyLayout()
    layout.header = [
      {
        id: 'birthday',
        kind: 'input',
        type: 'date',
        name: 'birthday',
        label: '生年月日',
        destinations: { friendFieldIds: ['field-birthday'] },
      },
    ]
    layout.sections[0].blocks = [
      {
        id: 'name',
        kind: 'input',
        type: 'text',
        name: 'name',
        label: 'お名前',
        destinations: {
          friendFieldIds: ['field-name', 'field-name'],
          realName: true,
        },
      },
      {
        id: 'plan',
        kind: 'input',
        type: 'radio',
        name: 'plan',
        label: 'プラン',
        choiceMode: 'action',
        choices: [
          {
            id: 'yes',
            label: '継続',
            tagId: 'tag-continue',
            actions: [
              { kind: 'friend_field', fieldId: 'field-plan', value: '継続' },
              { kind: 'tag', op: 'add', tagIds: ['tag-continue', 'tag-customer'] },
            ],
          },
        ],
      },
    ] satisfies FormInputBlock[]
    layout.options.afterActions = [
      { kind: 'friend_field', fieldId: 'field-plan', value: '済' },
      { kind: 'tag', op: 'add', tagIds: ['tag-customer'] },
    ]

    expect(summarizeFormDestinations(layout, 'tag-submit')).toEqual({
      friendFieldCount: 4,
      tagCount: 3,
      label: '友だち情報欄 4・タグ 3',
    })
  })

  it('保存先が無いことも実値0として表示する', () => {
    expect(summarizeFormDestinations(emptyLayout(), null)).toEqual({
      friendFieldCount: 0,
      tagCount: 0,
      label: '友だち情報欄 0・タグ 0',
    })
  })
})

describe('hasStoredDestination', () => {
  it('保存先が無いときだけ偽（文言が変わっても絞り込みが嘘にならない）', () => {
    expect(hasStoredDestination(emptyLayout(), null)).toBe(false)
  })

  it('情報欄・タグ・回答時タグのどれかがあれば真', () => {
    const layout = emptyLayout()
    layout.header = [
      {
        id: 'name',
        kind: 'input',
        type: 'text',
        name: 'name',
        label: 'お名前',
        destinations: { friendFieldIds: ['field-name'] },
      },
    ]
    expect(hasStoredDestination(layout, null)).toBe(true)
    expect(hasStoredDestination(emptyLayout(), 'tag-submit')).toBe(true)
  })
})
