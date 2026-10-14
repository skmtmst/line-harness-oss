import { Children, Fragment, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ListPage, type ListPageProps } from '@/components/templates'
import { PageContent } from '@/components/templates/page-frame'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
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
    {search ? <ListToolbarSearchSlot width={search.width}><SearchField value={search.value} onChange={search.onChange} onClear={() => search.onChange('')} placeholder={search.placeholder} aria-label={search.label ?? search.placeholder} maxLength={search.maxLength} loading={search.loading} /></ListToolbarSearchSlot> : null}
    {filterItems(filters)}
    {trailing ? <ListToolbarEnd>{trailing}</ListToolbarEnd> : null}
  </ListToolbarRow></ListToolbarFrame>
}

function filterItems(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((node, index) => {
    if (!isValidElement<{ children?: ReactNode }>(node)) return [node]
    const key = `${prefix}${node.key ?? index}`
    return node.type === Fragment ? filterItems(node.props.children, `${key}/`) : [cloneElement(node, { key })]
  })
}
