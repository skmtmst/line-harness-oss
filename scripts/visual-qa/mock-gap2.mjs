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
      staffId: blocked ? null : 'bs-1',
      reason: blocked ? 'slot_unavailable' : null,
      alternatives: blocked && (i - 2) % 6 === 0 ? [alt, new Date(at.getTime() + 3_600_000).toISOString(), new Date(at.getTime() - 3_600_000).toISOString()] : [],
    })
  }
  return list
}

const DAYS = ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01', '2027-01-08']
const SERIES_BOOKINGS = DAYS.map((day, i) => ({ id: i === 3 ? 'bk-series-4' : `bk-series-${i + 1}`, series_id: 's1', series_index: i, starts_at: `${day}T05:00:00.000Z`, ends_at: `${day}T06:45:00.000Z`, status: 'confirmed', menu_id: 'bm-1', staff_id: 'bs-1', friend_id: 'friend-6' }))

/** [status, body] を返す。扱わない道は null。形は API-CONTRACT-GAP2（B4）のとおり。 */
export function gap2Respond(method, pathname, body = {}) {
  const ok = (data) => [200, { success: true, data }]
  if (method === 'POST' && pathname === '/api/booking/admin/series/preview') return ok({ occurrences: occurrences(body.startsAt, body.rule) })
  if (method === 'POST' && pathname === '/api/booking/admin/series') {
    const kept = (body.choices ?? []).filter((c) => c.action === 'keep')
    return ok({ series: { id: 's-new', version: 1 }, bookings: kept.map((c) => ({ id: `bk-new-${c.index}`, series_index: c.index })), skipped: [] })
  }
  if (method === 'GET' && /^\/api\/booking\/admin\/series\/[^/]+$/.test(pathname)) return ok({ series: { id: 's1', version: 3, rule_json: JSON.stringify({ freq: 'weekly' }), status: 'active' }, bookings: SERIES_BOOKINGS })
  if (method === 'PATCH' && /^\/api\/booking\/admin\/series\/[^/]+$/.test(pathname)) return ok({ changed: body.scope === 'this' ? ['bk-series-4'] : ['bk-series-4', 'bk-series-5', 'bk-series-8'], conflicts: body.scope === 'this' ? [] : ['bk-series-7'], version: 4 })
  if (method === 'POST' && /^\/api\/booking\/admin\/series\/[^/]+\/cancel$/.test(pathname)) return ok({ cancelled: body.scope === 'this' ? ['bk-series-4'] : ['bk-series-4', 'bk-series-5', 'bk-series-7', 'bk-series-8'], fees: [{ bookingId: 'bk-series-4', feeNow: 4200 }], version: 4 })
  return null
}
