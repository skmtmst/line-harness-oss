import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(new URL('../../../v8/webinar-edit/edit.tsx', import.meta.url), 'utf8')
const NOTIFICATION_SCREEN = fs.readFileSync(new URL('../../../v8/webinar-edit/notifications.tsx', import.meta.url), 'utf8')
const CTA = fs.readFileSync(new URL('../../../v8/webinar-edit/cta.tsx', import.meta.url), 'utf8')
describe('V8 ウェビナー通知・CTAの取得の契約', () => {
  it('通知の取得口は子の編集タブの1か所だけ', () => {
    /* 親は取らず、子の報告を受けるだけ。 */
    expect(PAGE).not.toContain('webinarApi.notifications(')
    expect(NOTIFICATION_SCREEN.match(/webinarApi\.notifications\(/g)).toHaveLength(1)
    expect(NOTIFICATION_SCREEN).toContain('setSettings(res.data.settings)')
    expect(NOTIFICATION_SCREEN).toContain('webinarApi.notifications(webinarId)')
    expect(NOTIFICATION_SCREEN).toContain('setBaseline(res.data.settings)')
    /* 段を畳まないので、未保存の印と保存操作を親の固定バーへ渡す。 */
    expect(NOTIFICATION_SCREEN).toContain('onDirtyChange(dirty)')
    expect(NOTIFICATION_SCREEN).toContain('registerSave(() => saveRef.current())')
  })

  it('CTAは編集タブで取得し、競合の読み直しも同じタブで行う', () => {
    expect(PAGE).not.toContain('webinarApi.ctas(')
    expect(CTA.match(/webinarApi\.ctas\(/g)).toHaveLength(2)
    expect(CTA).toContain('const readLatest = async () =>')
    expect(CTA).toContain('onCtasReport(res.data)')
    expect(PAGE).toContain('onCtasReport: handleCtasReport,')
  })

  it('保存結果をすぐ反映し、通知の運用状態を読み直す', () => {
    expect(CTA).toContain('onCtasReport(next)')
    expect(NOTIFICATION_SCREEN).toContain('setSettings(res.data.settings)')
    expect(NOTIFICATION_SCREEN).toContain('void load()')
  })
})
