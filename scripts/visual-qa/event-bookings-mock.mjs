/** イベント予約一覧の見本も、Worker と同じ絞込・並び・ページ契約で返す。 */
export function eventBookingsPage(url, bookings) {
  const positiveInteger = (value, fallback) => {
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? number : fallback
  }
  const page = positiveInteger(url.searchParams.get('page'), 1)
  const limit = Math.min(positiveInteger(url.searchParams.get('limit'), 200), 200)
  const eventId = url.pathname.split('/')[5]
  const status = url.searchParams.get('status')
  const slotId = url.searchParams.get('slot_id')
  const items = bookings.filter(booking => booking.event_id === eventId
    && (!status || booking.status === status) && (!slotId || booking.slot_id === slotId))
    .sort((one, two) => String(two.requested_at).localeCompare(String(one.requested_at)) || two.id.localeCompare(one.id))
  const offset = (page - 1) * limit
  return {
    items: items.slice(offset, offset + limit), total: items.length, limit,
    sort: [{ field: 'requested_at', direction: 'desc' }, { field: 'id', direction: 'desc' }],
  }
}
