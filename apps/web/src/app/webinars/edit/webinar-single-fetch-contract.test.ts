import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/edit.tsx'), 'utf8')
const NOTIFICATION_SCREEN = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/notifications.tsx'), 'utf8')
const CTA = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/cta.tsx'), 'utf8')
const NOTIFICATIONS = NOTIFICATION_SCREEN

describe('V8 ウェビナー通知・CTAの取得一本化の契約', () => {
  it('通知の取得口は子の編集タブの1か所だけ', () => {
    /* 親は取らず、子の報告を受けるだけ。 */
    expect(PAGE).not.toContain('webinarApi.notifications(')
    expect(NOTIFICATIONS.match(/webinarApi\.notifications\(/g)).toHaveLength(1)
    expect(NOTIFICATIONS).toContain('setSettings(res.data.settings)')
    expect(NOTIFICATIONS).toContain('setOverview(res.data.overview ?? null)')
    /* 段を畳まないので、未保存の印と保存操作を親の固定バーへ渡す。 */
    expect(NOTIFICATION_SCREEN).toContain('onDirtyChange(dirty)')
    expect(NOTIFICATION_SCREEN).toContain('registerSave(() => saveRef.current())')
  })

  it('CTAの取得口は子の編集タブの1か所だけ', () => {
    expect(PAGE).not.toContain('webinarApi.ctas(')
    expect(CTA.slice(CTA.indexOf('const loadCtas'), CTA.indexOf('void loadCtas()')).match(/webinarApi\.ctas\(/g)).toHaveLength(1)
    expect(CTA).toContain('onCtasReport(res.data)')
    expect(PAGE).toContain('onCtasReport: handleCtasReport')
  })

  it('保存したら取り直しのGETを挟まず親へ流す', () => {
    expect(CTA).toContain('onCtasReport(next)')
    expect(NOTIFICATIONS).toContain('void load();')
  })
})
