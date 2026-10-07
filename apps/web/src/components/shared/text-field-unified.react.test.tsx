// @vitest-environment happy-dom
/*
 * 入力欄の1本化（2026-10-08）。入力欄の正本は text-field.tsx の TextField・TextArea。
 * form-controls.tsx の TextInput・TextArea はその薄い包み。Field の中に置いた欄へは、
 * 説明・誤りの文・文字数の読み上げ（aria-describedby）、誤り（aria-invalid）、
 * 必須（aria-required）を部品が自動でつなぐ。複数行は縦にだけ広げられる。
 */
import { readFileSync } from 'node:fs'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field, TextArea as LegacyTextArea, TextInput } from './form-controls'
import { TextArea, TextField } from './text-field'

afterEach(() => cleanup())

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const describedText = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(無い id: ${id})`)

describe('Field と入力欄の読み上げ', () => {
  it('説明を aria-describedby でつなぐ（呼ぶ側の分も残す）', () => {
    render(
      <>
        <p id="outside">外の説明</p>
        <Field label="配信の名前" htmlFor="name" note="お客さまには見えません">
          <TextField id="name" aria-describedby="outside" />
        </Field>
      </>,
    )
    const input = screen.getByLabelText('配信の名前')
    expect(describedText(input)).toEqual(['外の説明', 'お客さまには見えません'])
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('誤りの文が出ている間は aria-invalid と誤りの文の読み上げを付け、打ち直し中は外す', () => {
    render(
      <Field label="配信の名前" htmlFor="name" note="お客さまには見えません" error="名前を入力してください">
        <TextField id="name" />
      </Field>,
    )
    const input = screen.getByLabelText('配信の名前')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(describedText(input)).toEqual(['名前を入力してください'])
    fireEvent.input(input, { target: { value: 'あ' } })
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(describedText(input)).toEqual(['お客さまには見えません'])
  })

  it('必須の札があれば aria-required を付ける', () => {
    render(
      <Field label="本文" htmlFor="body" required>
        <TextArea id="body" />
      </Field>,
    )
    expect(screen.getByLabelText(/本文/).getAttribute('aria-required')).toBe('true')
  })

  it('htmlFor だけ渡せば欄に id を振り、ラベルとつなぐ', () => {
    render(
      <Field label="メモ" htmlFor="memo">
        <TextArea />
      </Field>,
    )
    expect(screen.getByLabelText('メモ').tagName).toBe('TEXTAREA')
  })

  it('文字数を欄の下に出し、読み上げにつなぎ、上限を超えたら印を付ける', () => {
    const view = render(
      <Field label="本文" htmlFor="body" count={{ value: 3, max: 10 }}>
        <TextArea id="body" />
      </Field>,
    )
    const area = screen.getByLabelText('本文')
    expect(describedText(area)).toEqual(['3/10文字'])
    expect(view.container.querySelector('[data-field-count]')?.getAttribute('data-field-count')).toBe('')
    view.rerender(
      <Field label="本文" htmlFor="body" count={{ value: 1200, max: 1000 }}>
        <TextArea id="body" />
      </Field>,
    )
    expect(describedText(screen.getByLabelText('本文'))).toEqual(['1,200/1,000文字'])
    expect(view.container.querySelector('[data-field-count]')?.getAttribute('data-field-count')).toBe('over')
  })

  it('Field の外では何も足さない', () => {
    render(<TextField aria-label="名前" />)
    const input = screen.getByLabelText('名前')
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-required')).toBeNull()
  })

  it('invalid を渡せば Field の外でも aria-invalid を付ける', () => {
    render(<TextField aria-label="名前" invalid />)
    expect(screen.getByLabelText('名前').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('TextInput・TextArea（form-controls）は正本の包み', () => {
  it('正本と同じ見た目の class を持ち、ref も届く', () => {
    const inputRef = React.createRef<HTMLInputElement>()
    const areaRef = React.createRef<HTMLTextAreaElement>()
    render(
      <>
        <TextField aria-label="正本1行" />
        <TextInput aria-label="包み1行" ref={inputRef} />
        <TextArea aria-label="正本複数行" />
        <LegacyTextArea aria-label="包み複数行" ref={areaRef} />
      </>,
    )
    const base = screen.getByLabelText('正本1行').className.split(' ')
    const wrapped = screen.getByLabelText('包み1行').className.split(' ')
    expect(base.every((name) => wrapped.includes(name))).toBe(true)
    const baseArea = screen.getByLabelText('正本複数行').className.split(' ')
    const wrappedArea = screen.getByLabelText('包み複数行').className.split(' ')
    expect(baseArea.every((name) => wrappedArea.includes(name))).toBe(true)
    expect(inputRef.current?.tagName).toBe('INPUT')
    expect(areaRef.current?.tagName).toBe('TEXTAREA')
  })

  it('form-controls は入力欄の見た目を自分で持たない（v7 の差は v7 のときだけ）', () => {
    const css = withoutComments(read('./form-controls.module.css'))
    expect(css).not.toMatch(/\.(control|input|textarea)\s*\{/)
    // v7 の差（読み取り専用の地・押せないときの薄さ・大きさ固定）は v7 に閉じる。
    for (const rule of css.match(/[^{}]*\.legacy(Control|Textarea)[^{]*\{/g) ?? []) {
      expect(rule).toMatch(/:root:not\(\[data-theme='v8'\]\)/)
    }
  })
})

describe('複数行の決まり：縦にだけ広げられる・最小の高さ 120', () => {
  const css = withoutComments(read('./text-field.module.css'))
  /** @layer の外（深さ0）に書いた規定だけを集める。 */
  const outsideLayer = (() => {
    let depth = 0
    let start = 0
    const rules: string[] = []
    for (let i = 0; i < css.length; i += 1) {
      if (css[i] === '{') {
        if (depth === 0) start = i
        depth += 1
      } else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) {
          const head = css.slice(css.lastIndexOf('}', start) + 1, start)
          if (!head.includes('@layer')) rules.push(`${head.trim()} ${css.slice(start, i + 1)}`)
        }
      }
    }
    return rules.join('\n')
  })()

  it('最小の高さは 120px', () => {
    expect(css).toMatch(/\.multi\s*\{[^}]*min-height:\s*120px/)
  })

  it('層の外で resize: vertical を決め、画面の className に負けない', () => {
    expect(outsideLayer).toMatch(/\.multi\s*\{[^}]*resize:\s*vertical/)
    expect(css).not.toMatch(/resize:\s*(both|horizontal|none)/)
  })

  it('画面に直接書いた textarea も v8 では縦だけが既定', () => {
    const globals = withoutComments(read('../../app/globals.css'))
    expect(globals).toMatch(/\[data-theme='v8'\] textarea\s*\{\s*resize:\s*vertical;\s*\}/)
  })
})
