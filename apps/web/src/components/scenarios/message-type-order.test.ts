import { describe, expect, it } from 'vitest'
import { COMPOSER_TYPES } from '@/components/shared/message-composer'
import { STEP_MESSAGE_KINDS } from './message-type-tabs'

describe('本文の種類の並び', () => {
  it('両方にある種類はシナリオと一斉配信で同じ順に並ぶ', () => {
    const step = STEP_MESSAGE_KINDS.map((kind) => kind.value as string)
    const composer = COMPOSER_TYPES.map(([kind]) => kind as string)
    expect(step.filter((kind) => composer.includes(kind))).toEqual(composer.filter((kind) => step.includes(kind)))
    const withQuestion = [...composer.slice(0, 10), 'question', ...composer.slice(10)]
    expect(step.filter((kind) => withQuestion.includes(kind))).toEqual(withQuestion.filter((kind) => step.includes(kind)))
  })
})
