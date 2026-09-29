import { describe, expect, it } from 'vitest'
import { createLatestPreviewRequestGate } from './latest-preview-request'

describe('成果地点の試算要求', () => {
  it('新しい入力を送ると古い要求を中断し、古い応答を採用しない', () => {
    const gate = createLatestPreviewRequestGate()
    const oldRequest = gate.start()
    const latestRequest = gate.start()

    expect(oldRequest.signal.aborted).toBe(true)
    expect(oldRequest.isCurrent()).toBe(false)
    expect(latestRequest.signal.aborted).toBe(false)
    expect(latestRequest.isCurrent()).toBe(true)
  })

  it('画面を離れた要求も採用しない', () => {
    const request = createLatestPreviewRequestGate().start()
    request.abort()

    expect(request.signal.aborted).toBe(true)
    expect(request.isCurrent()).toBe(false)
  })
})
