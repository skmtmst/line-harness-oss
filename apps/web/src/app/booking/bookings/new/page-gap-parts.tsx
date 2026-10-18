'use client'

import Link from 'next/link';
import Checkbox from '@/components/shared/checkbox';


function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="border-hairline bg-canvas rounded-card border p-5"><h2 className="text-ink text-sm font-semibold">{title}</h2>{note ? <p className="text-ink-faint mt-1 text-xs">{note}</p> : null}<div className="mt-4">{children}</div></section>
}


/** N-391: 通知の送る／送らないを予約ごとに選ぶトグル。 */
function NotificationToggle({ checked, onChange, title, detail }: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  detail: string
}) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onChange}
      description={detail}
    >{title}</Checkbox>
  )
}


function RelatedLinks({ includeConversion }: { includeConversion: boolean }) {
  return (
    <Card title="つながる先">
      <div className="text-ink-secondary space-y-2 text-xs">
        <p><Link href="/booking/bookings" className="text-action font-semibold underline">→ 予約管理</Link>　今日の台帳</p>
        <p><Link href="/booking/menus" className="text-action font-semibold underline">→ 予約設定</Link>　メニューと空き枠</p>
        <p><Link href="/reminders" className="text-action font-semibold underline">→ リマインダ</Link>　前日・開始前のお知らせ</p>
        <p><Link href="/friends" className="text-action font-semibold underline">→ 友だち</Link>　顧客カルテに残ります</p>
        {includeConversion ? <p><Link href="/conversions" className="text-action font-semibold underline">→ コンバージョン</Link>　予約の成果を確認</p> : null}
      </div>
    </Card>
  )
}
export { Card, NotificationToggle, RelatedLinks }
