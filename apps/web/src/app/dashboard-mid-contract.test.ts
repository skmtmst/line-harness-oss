import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const QR = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/qr-dialog.tsx'), 'utf8')
const SHIPMENT = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/shipment-panel.tsx'), 'utf8')
const NOTIFY = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/notification-summary.ts'), 'utf8')

/** 注釈を落とす。「なぜ直したか」の文が字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('ダッシュボード点検・中の契約(#491)', () => {
  it('中2:予約の明細は今日以降100件に区切り、器違いで落ちない', () => {
    expect(PAGE).toContain("bookingApi.listRequests(selectedAccountId, 'all', { from: todayStartIso, limit: 100 })")
    expect(PAGE).toContain('Array.isArray(bookingResult.value.requests) ? bookingResult.value.requests : null')
  })

  it('中3:追加URL一覧は外で1回取り、QRダイアログへ渡す', () => {
    expect(PAGE).toContain('routes={routes}')
    expect(QR).toContain('const routes = routesProp ?? fetchedRoutes')
    expect(QR).toContain('if (!open || routesProp) return')
    expect(QR.match(/api\.entryRoutes\.list\(\)/g)).toHaveLength(1)
  })

  it('中4:壊れた日付で画面を落とさず、今日の数に入れない', () => {
    expect(code(PAGE)).toContain("if (Number.isNaN(date.getTime())) return ''")
  })

  it('中5:出荷予定の失敗は決まった文と読み直しを出す', () => {
    expect(code(SHIPMENT)).toContain("setError('出荷予定を取得できませんでした')")
    expect(SHIPMENT).toContain('もう一度読み込む')
    expect(SHIPMENT).toContain('setAttempt((count) => count + 1)')
    expect(code(SHIPMENT)).not.toContain('e.message')
  })

  it('中7:知らない種類の通知も行き先があり、押して何も起きない tap にしない', () => {
    expect(code(NOTIFY)).toContain("return '/updates'")
    expect(code(NOTIFY)).not.toContain('return null')
    expect(PAGE).toContain('router.push(destination)')
  })
})
