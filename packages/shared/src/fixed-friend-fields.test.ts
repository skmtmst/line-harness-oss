import { describe, expect, test } from 'vitest'
import { ageFromBirthday, FIXED_FRIEND_FIELDS } from './fixed-friend-fields'
import { emptyLayout, normalizeLayout, validateAnswer, validateFormDefinition, type FormInputBlock } from './form-layout'

describe('fixed form fields', () => {
  test('JST birthday, future and invalid dates', () => {
    const now = new Date('2026-10-09T15:00:00Z')
    expect(ageFromBirthday('2000-10-10', now)).toBe(26)
    expect(ageFromBirthday('2000-10-11', now)).toBe(25)
    expect(ageFromBirthday('2027-01-01', now)).toBeNull()
    expect(ageFromBirthday('2000-02-30', now)).toBeNull()
  })
  test.each(FIXED_FRIEND_FIELDS)('fixed $key round trips without store IDs', spec => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [{ id: 'q', kind: 'input', name: 'answer', label: spec.label, type: spec.type, fixedField: spec.key }]
    expect(validateFormDefinition(layout)).toBeNull()
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)))?.sections[0].blocks[0]).toMatchObject({ fixedField: spec.key })
  })
  test('changing the limit does not disable validation of an age or email', () => {
    const block: FormInputBlock = { id: 'q', kind: 'input', name: 'age', label: '年齢', type: 'text', fixedField: 'age' }
    expect(validateAnswer(block, '35')).toBeNull()
    for (const value of ['-1', '151', '3.5', '文字']) expect(validateAnswer(block, value)).toBeTruthy()
    expect(validateAnswer({ ...block, fixedField: 'email' }, 'not-an-email')).toBeTruthy()
  })
  test('unknown input/decorations are rejected before normalization can drop them', () => {
    for (const block of [{ id: 'x', kind: 'unknown' }, { id: 'x', kind: 'input', type: 'unknown' }, { id: 'x', kind: 'input', type: 'radio', fixedField: 'name' }]) {
      const layout = emptyLayout()
      layout.sections[0].blocks = [block as never]
      expect(normalizeLayout(layout)).toBeNull()
      expect(validateFormDefinition(layout)).toBeTruthy()
    }
  })
})
