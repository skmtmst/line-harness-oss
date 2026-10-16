import { CreditCard, Inbox, MessageCircle, Users } from 'lucide-react'
import type { OpsTenantDetail } from '@/lib/api'
import { planLabel } from '@/components/ops/ops-ui'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'

export default function TenantOverviewStats({ detail }: { detail: OpsTenantDetail }) {
  const accounts = detail.accounts.filter(account => !account.archived_at)
  const friends = accounts.every(account => Number.isFinite(account.friend_count) && account.friend_count >= 0)
    ? accounts.reduce((total, account) => total + account.friend_count, 0)
    : null
  return (
    <KpiBand aria-label="契約先の利用状況">
      <KpiCard presentation="band" title="月額" icon={<CreditCard size={13} aria-hidden="true" />} value={null} unit="円" detail={`${planLabel(detail.tenant.plan_key)}・金額は未取得`} />
      <KpiCard presentation="band" title="アカウント" icon={<MessageCircle size={13} aria-hidden="true" />} value={detail.tenant.account_count} unit="件" detail="アーカイブを除く" />
      <KpiCard presentation="band" title="友だち" icon={<Users size={13} aria-hidden="true" />} value={friends} unit="人" detail={friends === null ? '友だち数は未取得' : 'アーカイブを除くアカウントの合計'} />
      <KpiCard presentation="band" title="お問い合わせ" icon={<Inbox size={13} aria-hidden="true" />} value={null} unit="件" detail="件数は未取得" />
    </KpiBand>
  )
}
