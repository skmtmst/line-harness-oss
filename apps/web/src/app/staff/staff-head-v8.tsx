import { Tabs } from '@/components/shared/tabs'

import Notice from '@/components/shared/notice'
import { PageHeading } from '@/components/templates/page-frame'

export const STAFF_TAB_KEYS = [
  { key: 'members', label: 'いまいる人' }, { key: 'invited', label: '招待中' },
  { key: 'audit', label: '入った記録' }, { key: 'roles', label: '権限のかたまり' },
] as const

/**
 * ログインユーザー画面のV8見出し。`page.tsx` は `PageHeader` の仕組みに
 * 寄せる決まり（本文に h1 を直書きしない）のため、V8 の見出しだけを
 * ここに置く。見た目は変えない。
 */
export default function StaffHeadV8({ tab, administrator }: { tab: string; administrator: boolean }) {
  return (
    <div>
      <PageHeading title="ログインユーザー" help={<> 管理画面に入る人と、その人ができることを決めます（管理者の設定はここ）</>} />

      <Tabs label="ログインユーザーの切り替え" items={STAFF_TAB_KEYS.map(item => ({label:item.label, href:`/staff?tab=${item.key}`, current:tab===item.key}))} />
      {!administrator ? <Notice tone="info" className="mt-3">閲覧のみで見ています。変える操作は管理者に頼んでください。</Notice> : null}
    </div>
  )
}
