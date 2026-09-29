import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ApiError } from '@/lib/api'
import { loadFailureKind } from './load-failure-kind'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M012：対応状況の保存・シナリオ登録の失敗で内部文が出る。
 * 画面側は原文（`API error: 403`）をそのまま出さず、共通の
 * `describeSaveFailure`（状態別の日本語案内）へ渡す。
 * 読み込み 403 は権限不足として区別する。
 */
describe('M012 友だち詳細の失敗表示', () => {
  it('読み込み失敗の種類を権限不足とそれ以外に分ける', () => {
    expect(loadFailureKind(new ApiError(403, 'API error: 403'))).toBe('forbidden')
    expect(loadFailureKind(new ApiError(500, 'API error: 500'))).toBe('error')
    expect(loadFailureKind(new TypeError('Failed to fetch'))).toBe('error')
    expect(loadFailureKind(null)).toBe('error')
  })

  it('対応状況の保存失敗は共通の状態別案内へ渡す', () => {
    expect(PAGE).toContain('setSupportError(describeSaveFailure(err))')
    expect(PAGE).not.toContain('setSupportError(err instanceof ApiError ? err.message')
  })

  it('シナリオ登録の失敗は共通の状態別案内へ渡す', () => {
    expect(PAGE).toContain('setScenarioError(describeSaveFailure(err))')
    expect(PAGE).not.toContain('setScenarioError(err instanceof ApiError ? err.message')
  })

  it('読み込み 403 は権限不足の面に出し、再試行口は付けない', () => {
    expect(PAGE).toContain('loadFailureKind(err)')
    expect(PAGE).toContain('この友だちを見る権限がありません')
    // 権限不足の面は再試行口なし（押しても直らないため）。
    expect(PAGE).toContain('if (!loading && loadForbidden) {')
  })
})
