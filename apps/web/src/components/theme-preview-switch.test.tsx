// @vitest-environment happy-dom
/*
 * 画面の見た目（試作）の切り替え（★V8 移行②）。
 * このブラウザの localStorage と <html data-theme> だけに効く。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemePreviewSwitch from './theme-preview-switch'

/** Node の experimental localStorage は実体が無いので、happy-dom でも自前で立てる。 */
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  document.documentElement.dataset.theme = 'v7'
})

describe('画面の見た目（試作）の切り替え', () => {
  it('今のテーマを読んでスイッチに反映する', () => {
    document.documentElement.dataset.theme = 'v8'
    render(<ThemePreviewSwitch />)
    const toggle = screen.getByRole('switch', { name: '新しい見た目（V8・試作）を使う' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('オンにすると <html data-theme="v8"> と localStorage に残る', () => {
    render(<ThemePreviewSwitch />)
    fireEvent.click(screen.getByRole('switch'))
    expect(document.documentElement.dataset.theme).toBe('v8')
    expect(localStorage.getItem('lh-admin-theme')).toBe('v8')
  })

  it('オフにすると v7 に戻る', () => {
    document.documentElement.dataset.theme = 'v8'
    render(<ThemePreviewSwitch />)
    fireEvent.click(screen.getByRole('switch'))
    expect(document.documentElement.dataset.theme).toBe('v7')
    expect(localStorage.getItem('lh-admin-theme')).toBe('v7')
  })
})
