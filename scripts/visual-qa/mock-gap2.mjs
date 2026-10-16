/*
 * ③-2 第2弾（B4 繰り返し・B5 同伴・B6 答えで行き先を分ける）の撮影の見本。
 * 形は docs/v8-requirements/gap-features/B4〜B6 の「データと API の形の案」のとおり。口（Worker）が出来たら外す。
 * 保存はしない（POST でも毎回同じ形を返す）。回数・間隔・日時は送られた値から作る。
 */
const DAY = 86_400_000
const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3_600_000)

/** 取れない回：3 回目から 3 つおき（11/20 起点の 8 回なら 12/04 と 12/25）。 */
function occurrences(startsAt, rule) {
  const count = Math.min(Math.max(Number(rule?.count) || 8, 2), 52)
  const start = new Date(startsAt)
  const list = []
  for (let i = 0; i < count; i += 1) {
    let at
    if (rule?.freq === 'monthly_nth') {
      const base = jst(startsAt)
      const nth = Math.floor((base.getUTCDate() - 1) / 7)
      const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1, base.getUTCHours(), base.getUTCMinutes()))
      const shift = (base.getUTCDay() - first.getUTCDay() + 7) % 7
      first.setUTCDate(1 + shift + nth * 7)
      at = new Date(first.getTime() - 9 * 3_600_000)
    } else {
      at = new Date(start.getTime() + i * (rule?.freq === 'biweekly' ? 14 : 7) * DAY)
    }
    const startIso = at.toISOString()
    const blocked = i >= 2 && (i - 2) % 3 === 0
    const alt = new Date(at.getTime() + 2 * 3_600_000).toISOString()
    list.push({
      index: i, startsAt: startIso, available: !blocked,
      ...(blocked ? { reason: (i - 2) % 6 === 0 ? '佐々木が休み' : '14:00 に別の予約', alternatives: (i - 2) % 6 === 0 ? [alt, new Date(at.getTime() + 3_600_000).toISOString(), new Date(at.getTime() - 3_600_000).toISOString()] : [] } : { alternatives: [] }),
    })
  }
  return list
}

/** 4 回目（12/11）以降の 4 回。3 つ目（1/01）は埋まっている。 */
const impactItems = () => ['2026-12-11', '2026-12-18', '2027-01-01', '2027-01-08'].map((day, i) => ({
  bookingId: `bk-series-${i + 4}`, startsAt: `${day}T05:00:00.000Z`, after: `${day}T07:00:00.000Z`,
  blocked: i === 2, fee: i === 0 ? { amount: 4200, percent: 50, reason: '24 時間前を過ぎた' } : null,
}))

const PARTY = {
  groupId: 'grp-1', ownerName: '山田 花子', version: 1,
  members: [
    { bookingId: 'bk-4', label: 'チョコ', menuName: '爪切り', staffName: 'Kenta', startsAt: '2026-10-01T04:30:00.000Z', endsAt: '2026-10-01T04:45:00.000Z', status: 'confirmed' },
    { bookingId: 'bk-party-2', label: 'マロン', menuName: 'トリミング（中型犬）', staffName: '佐々木', startsAt: '2026-10-01T04:00:00.000Z', endsAt: '2026-10-01T05:30:00.000Z', status: 'confirmed' },
  ],
}
const SERIES_OF = {
  seriesId: 'ser-1', ruleText: '毎週金曜 14:00', total: 8, index: 4, version: 1,
  occurrences: ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01', '2027-01-08'].map((day, i) => ({ bookingId: i === 3 ? 'bk-series-4' : `bk-series-${i + 1}`, index: i + 1, startsAt: `${day}T05:00:00.000Z`, status: i < 3 ? 'confirmed' : 'confirmed' })),
}

/** [status, body] を返す。扱わない道は null。 */
export function gap2Respond(method, pathname, body = {}) {
  const ok = (data) => [200, { success: true, data }]
  if (method === 'POST' && pathname === '/api/booking/admin/series/preview') return ok({ occurrences: occurrences(body.startsAt, body.rule) })
  if (method === 'POST' && pathname === '/api/booking/admin/series') {
    const picks = body.choices ?? []
    const created = picks.filter((c) => c.action !== 'skip').length
    return ok({ seriesId: 'ser-new', created, skipped: picks.length - created })
  }
  if (method === 'POST' && /^\/api\/booking\/admin\/series\/[^/]+\/impact$/.test(pathname)) return ok({ items: impactItems() })
  if (method === 'PATCH' && /^\/api\/booking\/admin\/series\/[^/]+$/.test(pathname)) return ok({ changed: body.scope === 'this' ? 1 : 3, blocked: body.scope === 'this' ? 0 : 1, version: 2 })
  if (method === 'POST' && /^\/api\/booking\/admin\/series\/[^/]+\/cancel$/.test(pathname)) return ok({ cancelled: body.scope === 'this' ? 1 : 4 })
  if (method === 'GET' && /^\/api\/booking\/admin\/bookings\/[^/]+\/series$/.test(pathname)) return ok(pathname.includes('/bk-series-') ? SERIES_OF : null)
  if (method === 'GET' && /^\/api\/booking\/admin\/bookings\/[^/]+\/group$/.test(pathname)) return ok(/\/(bk-4|bk-party-2)\//.test(pathname) ? PARTY : null)
  if (method === 'POST' && /^\/api\/booking\/admin\/groups\/[^/]+\/cancel$/.test(pathname)) return ok({ cancelled: body.scope === 'member' ? 1 : 2 })
  return null
}
