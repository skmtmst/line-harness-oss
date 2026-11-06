// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'

/**
 * G3 はみ出し直し（parity 1004-0513：kpi-card_label 144 件）。
 * 狭いマスで題が器からはみ出す分は V8 の「…」で受け、全文は
 * title 属性で読める。折り返して2行にしない（数の位置がずれる）。
 */
describe('KpiCardの見出しのはみ出し（G3）', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('題の全文を title 属性に載せる', async () => {
    await act(async () => {
      root.render(<KpiCard title="今月の新規友だち数" value={12} unit="人" />)
      await Promise.resolve()
    })
    const label = host.querySelector('p[title="今月の新規友だち数"]')
    expect(label).not.toBeNull()
  })

  it("V8 の題は「…」で受ける（折り返さない・既存の見た目は変えない）", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'kpi-card.module.css'), 'utf8')
    expect(css).toMatch(/:root \.labelText \{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s)
  })

  it('題の終わりの「（…）」は別の札に分け、本体の言葉は切らない（ARuZ4・PMLkX）', async () => {
    await act(async () => {
      root.render(<KpiCard title="始まる見込み（試算）" value={116} unit="人" />)
      await Promise.resolve()
    })
    const label = host.querySelector('p[title="始まる見込み（試算）"]')
    expect(label?.textContent).toBe('始まる見込み（試算）')
    const parts = [...(label?.querySelectorAll('span span') ?? [])].map(span => span.textContent)
    expect(parts).toEqual(['始まる見込み', '（試算）'])
  })

  it('添え書きの無い題は分けない', async () => {
    await act(async () => {
      root.render(<KpiCard title="購読中" value={1} unit="人" />)
      await Promise.resolve()
    })
    expect(host.querySelector('p[title="購読中"] span span')).toBeNull()
  })
})
