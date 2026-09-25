// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import LiffDateTimePreview, { formatLiffDate } from './liff-preview'
import type { BookingAvailabilitySlot } from '@/lib/api'

/**
 * Issue #643: 予約設定の右パネルプレビューが、実際のLIFF
 * （apps/liff/src/components/DateTimePicker.tsx）と同じ構造かを
 * 実Reactで確かめる。
 *
 * 実LIFF: 「日時を選んでください」の下に、空きのある日が縦に並び、
 * 各日の下に時刻ボタンが4列（grid-cols-4）で並ぶだけ。
 * 月間カレンダー・○×休・凡例・「空き枠の内訳」は実画面に無い。
 */

const DIR = dirname(fileURLToPath(import.meta.url))
// shifts → staff → booking → app → src → web → apps → リポジトリ根
const REPO_ROOT = join(DIR, '../../../../../../..')
const LIFF_SOURCE = readFileSync(
  join(REPO_ROOT, 'apps/liff/src/components/DateTimePicker.tsx'),
  'utf8',
)
const LIFF_USER_MESSAGE_SOURCE = readFileSync(
  join(REPO_ROOT, 'apps/liff/src/lib/user-message.ts'),
  'utf8',
)
const PAGE_SOURCE = readFileSync(join(DIR, 'page.tsx'), 'utf8')

function slot(date: string, start: string): BookingAvailabilitySlot {
  return {
    date,
    start,
    end: '10:30',
    timeZone: 'Asia/Tokyo',
    startUtc: `${date}T${start}:00+09:00`,
    endUtc: `${date}T10:30:00+09:00`,
    capacity: 1,
    remaining: 1,
    state: 'available',
  }
}

afterEach(cleanup)

describe('前提: 実LIFFが「日時を選んでください」＋日付縦並び＋4列時刻ボタンの構造', () => {
  it('LIFF側の文言と構造が変わっていない（変わったらプレビューも追随が必要）', () => {
    expect(LIFF_SOURCE).toContain('日時を選んでください')
    expect(LIFF_SOURCE).toContain('この期間に空きはありません。')
    // 読み込み中・失敗は共通部品（LoadingView・LoadErrorView）で出す。
    expect(LIFF_SOURCE).toContain('LoadingView')
    expect(LIFF_SOURCE).toContain('LoadErrorView')
    expect(LIFF_USER_MESSAGE_SOURCE).toContain('読み込み中...')
    expect(LIFF_USER_MESSAGE_SOURCE).toContain(
      '読み込めませんでした。時間をおいて、もう一度お試しください。',
    )
    expect(LIFF_USER_MESSAGE_SOURCE).toContain('もう一度読み込む')
    // 旧い見せ方（枠ごとの文言・赤いそのまま表示）が復活していない。
    expect(LIFF_SOURCE).not.toContain('空き枠を取得中...')
    expect(LIFF_SOURCE).not.toContain('text-red-600')
    expect(LIFF_SOURCE).toContain('grid-cols-4')
    // LIFFにカレンダー表示が導入されたら検知できるよう、不在も確認する。
    expect(LIFF_SOURCE).not.toContain('grid-cols-7')
  })

  it('管理画面側に架空カレンダーの文言・構造が残っていない', () => {
    expect(PAGE_SOURCE).not.toContain('ご希望の日をえらんでください')
    expect(PAGE_SOURCE).not.toContain('空き枠の内訳')
    expect(PAGE_SOURCE).not.toContain('grid-cols-7')
  })
})

describe('プレビューが実LIFFと同じ構造で描画される', () => {
  const slots = [
    slot('2026-10-01', '10:00'),
    slot('2026-10-01', '10:30'),
    slot('2026-10-01', '11:00'),
    slot('2026-10-01', '11:30'),
    slot('2026-10-01', '13:00'),
    slot('2026-10-03', '09:00'),
    slot('2026-10-03', '09:30'),
  ]

  it('実文言「日時を選んでください」と案内文が出る', () => {
    render(
      <LiffDateTimePreview
        status="ready"
        slots={slots}
        menuName="カット"
        staffName="田中"
      />,
    )
    expect(screen.getByText('日時を選んでください')).toBeTruthy()
    expect(screen.getByText('確認画面で要望を入力してください')).toBeTruthy()
    expect(screen.getByText('← 戻る')).toBeTruthy()
    expect(screen.getByText('お客様のLINEではこう見えます')).toBeTruthy()
  })

  it('空きのある日だけが M/D(曜) 見出しのセクションで縦に並び、時刻ボタンが4列グリッド', () => {
    const { container } = render(
      <LiffDateTimePreview
        status="ready"
        slots={slots}
        menuName="カット"
        staffName="田中"
      />,
    )
    // LIFF formatJp と同じ見出し表記（2026-10-01 は木曜、10-03 は土曜）
    expect(screen.getByText('10/1(木)')).toBeTruthy()
    expect(screen.getByText('10/3(土)')).toBeTruthy()
    expect(formatLiffDate('2026-10-01')).toBe('10/1(木)')
    expect(formatLiffDate('2026-10-03')).toBe('10/3(土)')

    // LIFFと同じく、空きのある日1つにつき <section> が1つ。
    const sections = container.querySelectorAll('section')
    expect(sections.length).toBe(2)
    const grids = container.querySelectorAll('.grid.grid-cols-4')
    expect(grids.length).toBe(2)
    // 空きの無い日（10/2）は出ない。時刻はボタンとして並ぶ。
    expect(container.textContent).not.toContain('10/2(')
    for (const time of ['10:00', '10:30', '11:00', '11:30', '13:00', '09:00', '09:30']) {
      expect(within(container).getAllByText(time).length).toBeGreaterThan(0)
    }
    expect(container.querySelectorAll('button').length).toBe(7)
  })

  it('架空カレンダーの部品（曜日見出し・○×休・凡例・内訳）は出ない', () => {
    const { container } = render(
      <LiffDateTimePreview
        status="ready"
        slots={slots}
        menuName="カット"
        staffName="田中"
      />,
    )
    expect(container.textContent).not.toContain('ご希望の日をえらんでください')
    expect(container.textContent).not.toContain('空き枠の内訳')
    expect(container.textContent).not.toContain('あいています')
    expect(container.textContent).not.toContain('満席です')
    expect(container.querySelector('.grid-cols-7')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
  })

  it('空きが無いときは実LIFFと同じ「この期間に空きはありません。」', () => {
    render(
      <LiffDateTimePreview status="ready" slots={[]} menuName="カット" staffName="田中" />,
    )
    expect(screen.getByText('この期間に空きはありません。')).toBeTruthy()
  })

  it('取得中・失敗は実LIFFの共通部品と同じ文言とボタンで出す', () => {
    const { container: loadingContainer, unmount } = render(
      <LiffDateTimePreview status="loading" slots={[]} menuName="カット" staffName="田中" />,
    )
    expect(screen.getByText('読み込み中...')).toBeTruthy()
    expect(loadingContainer.textContent).not.toContain('空き枠を取得中...')
    unmount()
    const { container } = render(
      <LiffDateTimePreview status="error" slots={[]} menuName="カット" staffName="田中" />,
    )
    expect(
      screen.getByText('読み込めませんでした。時間をおいて、もう一度お試しください。'),
    ).toBeTruthy()
    expect(screen.getByText('もう一度読み込む')).toBeTruthy()
    // 実LIFFの失敗表示と同じく赤は使わず、旧い案内文も残さない。
    expect(container.querySelector('.text-danger')).toBeNull()
    expect(container.textContent).not.toContain('空き状況だけ読み込めませんでした。')
  })

  it('どのメニュー・担当の画面かを枠の外に注記する', () => {
    render(
      <LiffDateTimePreview
        status="ready"
        slots={slots}
        menuName="カット"
        staffName="田中"
      />,
    )
    expect(screen.getByText(/「カット」で担当「田中」/)).toBeTruthy()
  })
})
