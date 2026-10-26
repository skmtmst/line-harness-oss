import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ListSkeleton } from './skeleton'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** 読み込み中の形は型ごとに1つ。出てきた時に形が大きく変わらないように、本物と同じ並びの骨組みを出す。 */
describe('読み込み中の形はその画面の形', () => {
  it('予約の盤は見出しの段と時刻の列を持つ時間の表の枠', () => {
    const html = renderToStaticMarkup(<ListSkeleton shape="board" />)
    expect(html).toContain('data-skeleton-shape="board"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('ダッシュボードはカードの並び、予約管理は盤で待つ', () => {
    expect(read('v8/style-dashboard/style-dashboard.tsx')).toContain('<ListState kind="loading" loadingShape="cards" />')
    expect(read('v8/style-dashboard/home.tsx')).toContain('loadingShape="cards"')
    expect(read('app/booking/bookings/ledger-screen.tsx')).toContain('loadingShape="board" title="予約を読み込んでいます"')
  })

  it('読み込み中の数のカードは「—」ではなく骨組み（タグ・テンプレート）', () => {
    expect(read('v8/tags/tags-tab.tsx')).toMatch(/<KpiCard[\s\S]*?loading=\{!ready\}/)
    expect(read('v8/templates/list.tsx')).toMatch(/<KpiCard[\s\S]*?loading=\{loading\}/)
  })
})
