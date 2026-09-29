import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'

import { errorMessage } from './google-format'

/**
 * 本番のGoogleアカウント接続で、画面に `API error: 503` だけが出て
 * 利用者が次に何をすればよいか分からなくなった（Workerは
 * 「トークン暗号化キーが設定されていません」を返していたが、
 * `extractApiErrorMessage` が5xxの本文を画面へ渡さないため消えていた）。
 */
describe('Googleビジネス画面の失敗表示', () => {
  it('内部文言（API error: NNN）を画面へ出さない', () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503, 504]) {
      const text = errorMessage(new ApiError(status), 'Googleの認可画面を開けませんでした。')
      expect(text).not.toContain('API error')
    }
  })

  it('本文が届かない5xxでは、呼び出し側の日本語へ戻す', () => {
    expect(errorMessage(new ApiError(503), 'Googleの認可画面を開けませんでした。'))
      .toContain('Googleの認可画面を開けませんでした。')
  })

  it('設定不足は、運営へ連絡すればよいと分かる一言を添える', () => {
    const text = errorMessage(
      new ApiError(503, undefined, 'encryption_key_missing'),
      'Googleの認可画面を開けませんでした。',
    )
    expect(text).toBe('Googleの認可画面を開けませんでした。この環境の設定が足りていません。運営へ連絡してください。')
  })

  it('Google接続の設定が無い場合も、運営へ連絡すればよいと分かる', () => {
    expect(errorMessage(new ApiError(503, undefined, 'oauth_not_configured'), '接続できませんでした。'))
      .toContain('運営へ連絡してください。')
  })

  it('利用上限は、待てば直ると分かる', () => {
    expect(errorMessage(new ApiError(503, undefined, 'rate_limited'), '口コミを取得できませんでした。'))
      .toContain('しばらく待ってから')
  })

  it('Workerが本文を返す状態（400・409など）は、その日本語をそのまま出す', () => {
    expect(errorMessage(new ApiError(400, '本文を入力してください'), '保存できませんでした。'))
      .toBe('本文を入力してください')
    expect(errorMessage(new ApiError(409, 'この口コミにはすでに返信があります', 'already_replied'), '返信できませんでした。'))
      .toBe('この口コミにはすでに返信があります')
  })

  it('見覚えのない code では、余計な説明を足さない', () => {
    expect(errorMessage(new ApiError(500, undefined, 'something_new'), '読み込めませんでした。'))
      .toBe('読み込めませんでした。')
  })

  it('通信そのものが落ちた場合も、呼び出し側の日本語を出す', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), '読み込めませんでした。'))
      .toBe('読み込めませんでした。')
  })
})
