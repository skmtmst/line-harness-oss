import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const NOTIFICATIONS = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'webinars', 'webinar-notifications.tsx'),
  'utf8',
)

describe('V6 ウェビナー通知・CTAの取得一本化の契約', () => {
  it('通知の取得口は子の編集タブの1か所だけ', () => {
    /* 親は取らず、子の報告を受けるだけ。 */
    expect(PAGE).not.toContain('webinarApi.notifications(')
    expect(NOTIFICATIONS.match(/webinarApi\.notifications\(/g)).toHaveLength(1)
    expect(NOTIFICATIONS).toContain('onLoaded?.({ settings:')
    expect(PAGE).toContain('<WebinarNotifications key={notifAttempt} webinarId={webinarId} onLoaded={handleNotificationsLoaded} />')
  })

  it('CTAの取得口は子の編集タブの1か所だけ', () => {
    expect(PAGE.match(/webinarApi\.ctas\(/g)).toHaveLength(1)
    expect(PAGE).toContain('onCtasLoaded?.(res.data)')
    expect(PAGE).toContain('<CtasTab webinarId={webinarId} accountId={accountId} onCtasLoaded={handleCtasLoaded} />')
  })

  it('保存したら取り直しのGETを挟まず親へ流す', () => {
    expect(PAGE).toContain('onCtasLoaded?.(sorted)')
    expect(NOTIFICATIONS).toContain('await load()')
  })
})
