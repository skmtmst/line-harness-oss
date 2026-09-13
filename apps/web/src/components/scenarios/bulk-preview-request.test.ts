import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isCurrentPreviewRequest } from './bulk-preview-request'

const MODAL = readFileSync(new URL('./bulk-preview-modal.tsx', import.meta.url), 'utf8')

describe('シナリオ一括プレビューの連続取得', () => {
  it('新しい入力の後に届いた古い応答を採用しない', () => {
    let currentGeneration = 1
    let shown = ''
    const apply = (requestGeneration: number, value: string) => {
      if (isCurrentPreviewRequest(requestGeneration, currentGeneration)) shown = value
    }

    currentGeneration = 2
    apply(2, '新しい入力の結果')
    apply(1, '古い入力の結果')

    expect(shown).toBe('新しい入力の結果')
  })

  it('入力を間引き、次の入力では通信も中断する', () => {
    expect(MODAL).toContain('setTimeout(() => {')
    expect(MODAL).toContain('}, 300)')
    expect(MODAL).toContain('new AbortController()')
    expect(MODAL).toContain('.preview(scenarioId, iso, controller.signal)')
    expect(MODAL).toContain('controller.abort()')
  })
})
