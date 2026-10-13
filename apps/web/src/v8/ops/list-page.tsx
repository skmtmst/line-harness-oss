import type { ComponentProps } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ListPage, type ListPageProps } from '@/components/templates'
import { PageContent } from '@/components/templates/page-frame'
import Notice from '@/components/shared/notice'
import ListToolbar, { ListToolbarFrame, ListToolbarRow, ListToolbarSearchSlot, ListToolbarEnd } from '@/components/shared/list-toolbar'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'

export function OpsListPage({ stats, ...props }: ListPageProps) {
  const environment = opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)
  return <ListPage {...props} stats={<>
    <PageContent><Notice tone="warn" icon={<ShieldCheck aria-hidden="true" />} action={environment === 'staging' ? <span>検証環境</span> : undefined}>運営コンソール：契約先のデータを扱います。操作はすべて記録されます</Notice></PageContent>
    {stats}
  </>} />
}

export function OpsListToolbar({ search, filters, trailing }: Pick<ComponentProps<typeof ListToolbar>, 'search' | 'filters' | 'trailing'>) {
  return <ListToolbarFrame><ListToolbarRow>
    {search ? <ListToolbarSearchSlot width={search.width} search={search} /> : null}
    {filters}
    {trailing ? <ListToolbarEnd>{trailing}</ListToolbarEnd> : null}
  </ListToolbarRow></ListToolbarFrame>
}
