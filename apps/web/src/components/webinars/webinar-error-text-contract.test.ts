import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'

import { webinarErrorText } from './webinar-error-text'

describe('ウェビナー失敗文の日本語表示の契約', () => {
  it('知っている英字コードは日本語文に直す', () => {
    expect(webinarErrorText(new ApiError(400, 'invalid_slug', 'invalid_slug'), '予備文'))
      .toBe('URL用の名前が正しくありません。半角英数字と-だけ使えます。')
    expect(webinarErrorText(new ApiError(409, 'version_conflict', 'version_conflict'), '予備文'))
      .toBe('別の画面で更新されました。開き直してから試してください。')
  })

  it('知らないコード・コード無しは予備文をそのまま出す', () => {
    expect(webinarErrorText(new ApiError(500, 'Internal Server Error'), '公開できませんでした'))
      .toBe('公開できませんでした')
    expect(webinarErrorText(new Error('something_broke'), '操作を完了できませんでした。'))
      .toBe('操作を完了できませんでした。')
  })
})
