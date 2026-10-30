import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

let extractApiErrorMessage: typeof import('./api').extractApiErrorMessage
let extractApiErrorCode: typeof import('./api').extractApiErrorCode

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ extractApiErrorMessage, extractApiErrorCode } = await import('./api'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractApiErrorMessage', () => {
  it('400 では error を優先して取り出す', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: '入力してください' }), 400)).toBe(
      '入力してください',
    )
  })

  it('400 で error が無ければ message を使う', () => {
    expect(extractApiErrorMessage(JSON.stringify({ message: '権限がありません' }), 400)).toBe(
      '権限がありません',
    )
  })

  it('JSON でない本文は表示に使わない', () => {
    expect(extractApiErrorMessage('<html>internal details</html>', 400)).toBe('')
  })

  it('空の本文を許容する', () => {
    expect(extractApiErrorMessage('', 400)).toBe('')
  })

  it('error が文字列でない場合は使わない', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: { code: 500 } }), 400)).toBe('')
  })

  it('422 の検証文はそのまま運用者へ出す(#496-11)', () => {
    expect(extractApiErrorMessage(
      JSON.stringify({ error: 'Shift_JIS書き出しはまだ接続されていません。UTF-8を選んでください' }),
      422,
    )).toBe('Shift_JIS書き出しはまだ接続されていません。UTF-8を選んでください')
  })

  it.each([409, 422, 428])('%i の復旧可能な案内を表示する', (status) => {
    expect(extractApiErrorMessage(JSON.stringify({ error: '最新の内容を確認して、もう一度お試しください' }), status))
      .toBe('最新の内容を確認して、もう一度お試しください')
  })

  it.each([401, 403, 404, 429, 500, 502, 503])(
    '%i の本文は内部情報を含みうるため表示しない',
    (status) => {
      const body = JSON.stringify({ error: 'D1_ERROR: no such table: rich_menu_groups' })
      expect(extractApiErrorMessage(body, status)).toBe('')
    },
  )

  it.each([400, 409, 422, 428])('%i でも内部情報は表示しない', (status) => {
    expect(extractApiErrorMessage(JSON.stringify({ error: 'D1_ERROR: no such table: secrets' }), status)).toBe('')
  })
})

describe('extractApiErrorCode', () => {
  it('409や422でもsnake_caseの機械コードだけを取り出す', () => {
    expect(extractApiErrorCode(JSON.stringify({ error: 'slot_conflict' }))).toBe('slot_conflict')
    expect(extractApiErrorCode(JSON.stringify({ error: 'slot_not_available' }))).toBe('slot_not_available')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'common_var_delete_blocked',
      error: '使用先から外してください',
    }))).toBe('common_var_delete_blocked')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'rich_menu_delete_blocked',
      error: '削除する前に確認してください',
    }))).toBe('rich_menu_delete_blocked')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'media_delete_blocked',
      error: '先に使用先から外してください',
    }))).toBe('media_delete_blocked')
  })

  it('判定画面の大文字コードも取り出す(#496-12)', () => {
    expect(extractApiErrorCode(JSON.stringify({ code: 'STALE_CANDIDATE' }))).toBe('STALE_CANDIDATE')
    expect(extractApiErrorCode(JSON.stringify({ code: 'KIND_REQUIRED' }))).toBe('KIND_REQUIRED')
    expect(extractApiErrorCode(JSON.stringify({ code: 'COMMON_VAR_IN_USE' }))).toBe('COMMON_VAR_IN_USE')
    expect(extractApiErrorCode(JSON.stringify({ code: 'STALE_PERSON' }))).toBe('STALE_PERSON')
  })

  it('内部文言・HTML・文字列以外はコードとして受け取らない', () => {
    expect(extractApiErrorCode(JSON.stringify({ error: 'D1_ERROR: no such table' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ code: 'D1_ERROR: no such table' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ code: 'Failed to fetch friend rich menu: boom' }))).toBeUndefined()
    expect(extractApiErrorCode('<html>proxy error</html>')).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ error: { code: 'slot_conflict' } }))).toBeUndefined()
  })

  it('機能停止契約の固定コードだけは大文字でも受け取る', () => {
    expect(extractApiErrorCode(JSON.stringify({ code: 'FEATURE_DISABLED' }))).toBe('FEATURE_DISABLED')
    expect(extractApiErrorCode(JSON.stringify({ code: 'FORBIDDEN' }))).toBe('FORBIDDEN')
  })
})
