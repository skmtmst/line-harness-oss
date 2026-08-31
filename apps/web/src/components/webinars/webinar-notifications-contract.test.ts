import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const VIEW = fs.readFileSync(path.join(__dirname, 'webinar-notifications.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'webinars', 'edit', 'page.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'api.ts'), 'utf8')
const STEPS = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'webinars', 'edit', 'edit-steps.ts'), 'utf8')

describe('V6 ウェビナー通知とリマインドの契約', () => {
  it('実Nodeと通知設定の6種類を同じ画面で扱う', () => {
    expect(VIEW).toContain('data-design-node="Ho8z4"')
    expect(VIEW).toContain('申込直後の受付確認')
    expect(VIEW).toContain('前日の案内')
    expect(VIEW).toContain('開始前の案内')
    expect(VIEW).toContain('開始時の案内')
    expect(VIEW).toContain('見逃し案内')
    expect(VIEW).toContain('視聴完了のお礼')
  })

  it('読込失敗を空や0件として見せず、同じ場所で再読み込みできる', () => {
    expect(VIEW).toContain('kind="loading"')
    expect(VIEW).toContain('kind="error"')
    expect(VIEW).toContain('通知設定を読み込めませんでした')
    expect(VIEW).toContain('通知設定を再読み込み')
    expect(VIEW.indexOf('if (loading)')).toBeLessThan(VIEW.indexOf('if (loadError)'))
    expect(VIEW.indexOf('if (loadError)')).toBeLessThan(VIEW.indexOf('data-design-node="Ho8z4"'))
    expect(VIEW).not.toContain('API error:')
    expect(VIEW).not.toContain('Failed to fetch')
  })

  it('テスト送信・公開ページ確認・保存の行き先が操作名で分かる', () => {
    expect(VIEW).toContain('webinarApi.testNotifications(webinar.id)')
    expect(VIEW).toContain('テスト送信')
    expect(VIEW).toContain('公開ページを見る')
    expect(VIEW).toContain('通知設定を保存')
    expect(VIEW).toContain('target="_blank"')
  })

  it('既存の編集画面とAPIへ配線されている', () => {
    /*
      並びはタブから段（設計 4-8 の STEP 1〜5）へ変わった。
      **確かめたいのは「押して行ける場所があること」**なので、
      段の定義と、そこで実際に描かれることの両方を見る。
    */
    expect(STEPS).toContain("{ key: 'notifications', no: 4, title: '通知', mark: 'Ho8z4', node: 'Ho8z4' }")
    expect(PAGE).toContain("pane === 'notifications'")
    expect(PAGE).toContain('<WebinarNotifications webinar={webinar} publicUrl={publicUrl} />')
    expect(API).toContain('/notifications/test')
    expect(API).toContain('saveNotifications')
  })
})
