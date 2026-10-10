'use client'

import { Tabs } from '@/components/shared/tabs'
import './readonly-v8.css'

const groups = [
  { label: 'ふだん見る', tabs: [{ key: 'friends', label: '友だちの増減' }, { key: 'reactions', label: '配信の反応' }, { key: 'routes', label: '経路と成果' }, { key: 'url-clicks', label: 'URLクリック' }, { key: 'conversion-report', label: '成果地点ごとのレポート' }] },
  { label: '深く見る', tabs: [{ key: 'funnel', label: 'ファネル' }, { key: 'cross', label: 'クロス分析' }, { key: 'search', label: 'Search Console' }] },
  { label: '見直す', tabs: [{ key: 'usage', label: '使われ方' }, { key: 'saved', label: '保存した分析' }] },
]
const href = (key: string) => key === 'search' ? '/search-console' : `/analytics?tab=${key}`

/** レーンXの分析画面だけで使う二段の切り替え。選択状態はURLに残す。 */
export default function AnalyticsNavigationV8({ active, savedCount }: { active: string; savedCount?: number | null }) {
  const group = groups.find((item) => item.tabs.some((tab) => tab.key === active)) ?? groups[0]
  return <div className="v8-ro-analytics-navigation">
    <Tabs label="分析の組" items={groups.map(item => ({label:item.label,href:href(item.tabs[0].key),current:item===group}))} />
    <Tabs label="分析の見かた" items={group.tabs.map(item => ({label:item.label,href:href(item.key),current:item.key===active,count:item.key==='saved' ? savedCount ?? undefined : undefined}))} />
  </div>
}
