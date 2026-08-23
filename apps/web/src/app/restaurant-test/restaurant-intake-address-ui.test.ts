import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const consoleSource = readFileSync(new URL('./restaurant-console.tsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../../lib/restaurant-test-api.ts', import.meta.url), 'utf8')

describe('飲食店向け予約メール取り込みアドレス画面', () => {
  test('一覧・発行APIを店舗単位で呼び分ける', () => {
    expect(apiSource).toContain('listIntakeAddresses:')
    expect(apiSource).toContain('issueIntakeAddress:')
    expect(apiSource).toContain('encodeURIComponent(storeId)')
  })

  test('未発行・コピー・再発行確認・ドメイン未設定を運用者へ表示する', () => {
    for (const label of [
      '予約メール取り込みアドレス',
      '未発行',
      'アドレスを発行',
      'コピー済み',
      '旧アドレスは90日後に失効します',
      '取り込み用ドメインが未設定です',
    ]) {
      expect(consoleSource).toContain(label)
    }
    expect(consoleSource).toContain('navigator.clipboard.writeText(item.address)')
    expect(consoleSource).not.toMatch(/console\.(?:log|warn|error)\([^\n]*address/)
  })
})

describe('飲食店向け店舗とLINE公式アカウントの紐づけ画面', () => {
  test('店舗作成・編集APIを配線し、削除APIは持たない', () => {
    expect(apiSource).toContain('createStore:')
    expect(apiSource).toContain('updateStore:')
    expect(apiSource).toContain("method: 'PATCH'")
    expect(apiSource).not.toMatch(/deleteStore\s*:/)
  })

  test('LINE公式アカウントを必須選択にして使用中アカウントを選択不可にする', () => {
    for (const label of [
      '店舗管理',
      '店舗を追加',
      'LINE公式アカウント',
      '他店舗で使用中',
      'LINE: {store.line_account_name || \'未設定\'}',
      'アーカイブ',
    ]) {
      expect(consoleSource).toContain(label)
    }
    expect(consoleSource).toContain('disabled={usedElsewhere}')
    expect(consoleSource).not.toMatch(/店舗を削除|deleteStore/)
  })
})
