/** 開始日時を「10月10日（木）10:00」の形にする（Meet通知と同じ形）。 */
export function formatBookingDatetime(startsAt: string): string {
  const start = new Date(startsAt);
  const jst = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const iso = jst.toISOString();
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const time = iso.slice(11, 16);
  return `${month}月${day}日（${weekdays[jst.getUTCDay()]}）${time}`;
}
