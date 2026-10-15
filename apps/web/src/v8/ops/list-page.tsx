import { Children, Fragment, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ListPage, type ListPageProps } from '@/components/templates'
import { PageContent } from '@/components/templates/page-frame'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import ListToolbar, { ListToolbarFrame, ListToolbarRow, ListToolbarSearchSlot, ListToolbarEnd, ResponsiveFilterChips } from '@/components/shared/list-toolbar'

export function OpsListPage({ stats, ...props }: ListPageProps) {
  return <ListPage {...props} stats={<>
    <PageContent><Notice tone="warn" presentation="ops" icon={<ShieldCheck aria-hidden="true" />}>運営コンソール：契約先のデータを扱います。操作はすべて記録されます</Notice></PageContent>
    {stats ? <PageContent layout="stats">{stats}</PageContent> : null}
  </>} />
}

export function OpsListToolbar({ search, filters, trailing }: Pick<ComponentProps<typeof ListToolbar>, 'search' | 'filters' | 'trailing'>) {
  return <ListToolbarFrame><ListToolbarRow>
    {search ? <ListToolbarSearchSlot width={search.width} search={search} /> : null}
    {filterItems(filters)}
    {trailing ? <ListToolbarEnd>{trailing}</ListToolbarEnd> : null}
  </ListToolbarRow></ListToolbarFrame>
}

function filterItems(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap<ReactNode>((node, index) => {
    if (!isValidElement<{ children?: ReactNode }>(node)) return [node]
    const key = `${prefix}${node.key ?? index}`
    if (node.type !== Fragment) return [cloneElement(node, { key })]
    const items = Children.toArray(node.props.children)
    return items.length > 1 && items.every(item => isValidElement(item) && item.type === FilterChip)
      ? [<ResponsiveFilterChips key={key}>{items}</ResponsiveFilterChips>]
      : filterItems(node.props.children, `${key}/`)
  })
}
