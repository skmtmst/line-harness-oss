// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import Radio from './radio'

afterEach(() => cleanup())

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'radio.module.css'), 'utf8')

/*
 * 行内ラジオの小さい字（★BG-B `z14gEG` 人物2択）。
 * 文 12/17。丸 18・間隔 8・選択中の 5px は行内ラジオ（y4YQSB／gzxYf：文 13/20）
 * と同じまま。板の文字左端 1068・1163 に合う寸法なので、数字を変えると
 * ±4px の照合が外れる（docs/v8-design-rules.md §1 の2・§3）。
 */
describe('行内ラジオの小さい字（★BG-B z14gEG）', () => {
  it('size="small" で data-size が付く。既定は medium', () => {
    const small = render(<Radio name="person" value="without" size="small">入れない</Radio>)
    expect(small.container.firstElementChild!.getAttribute('data-size')).toBe('small')
    small.unmount()
    const def = render(<Radio name="person" value="with">入れる</Radio>)
    expect(def.container.firstElementChild!.getAttribute('data-size')).toBe('medium')
  })

  it('小さい字は v8 だけで文 12/17', () => {
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.label\s*\{[^}]*font-size:\s*var\(--text-caption\)/s,
    )
    expect(CSS).toMatch(
      /\[data-theme='v8'\]\s*\.root\[data-size='small'\]\s*\.label\s*\{[^}]*line-height:\s*17px/s,
    )
  })

  it('既定の文 13/20 と 丸 18・間隔 8 は変えない', () => {
    expect(CSS).toMatch(/\.label\s*\{[^}]*font-size:\s*var\(--text-label\)/s)
    expect(CSS).toMatch(/\.label\s*\{[^}]*line-height:\s*20px/s)
    expect(CSS).toMatch(/\.root\s*\{[^}]*gap:\s*8px/s)
    expect(CSS).toMatch(/\.input\s*\{[^}]*width:\s*18px/s)
  })
})
