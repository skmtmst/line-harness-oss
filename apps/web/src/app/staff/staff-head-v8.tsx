import Link from 'next/link'

import Notice from '@/components/shared/notice'

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
      <h1 className="text-ink text-xl font-bold">ログインユーザー</h1>
      <p className="text-ink-secondary mt-1 text-sm">管理画面に入る人と、その人ができることを決めます（管理者の設定はここ）</p>
      <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="ログインユーザーの切り替え">
        {STAFF_TAB_KEYS.map((item) => (
          <Link key={item.key} href={`/staff?tab=${item.key}`} aria-current={tab === item.key ? 'page' : undefined} className={tab === item.key ? 'border-b-2 border-ink pb-1 font-bold text-ink no-underline' : 'pb-1 text-ink-secondary no-underline hover:underline'}>{item.label}</Link>
        ))}
      </nav>
      {!administrator ? <Notice tone="info" className="mt-3">閲覧のみで見ています。変える操作は管理者に頼んでください。</Notice> : null}
    </div>
  )
}
