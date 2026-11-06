// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { scrollMotion } from './overlay-utils'

const original = window.matchMedia
const reduce = (matches: boolean) => { window.matchMedia = ((query: string) => ({ matches: matches && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia }

describe('画面の中を動かす時の速さ', () => {
  afterEach(() => { window.matchMedia = original })
  it('動きを減らす設定では一度で移る', () => {
    reduce(true)
    expect(scrollMotion()).toBe('auto')
  })
  it('ふだんはなめらかに流す', () => {
    reduce(false)
    expect(scrollMotion()).toBe('smooth')
  })
})
