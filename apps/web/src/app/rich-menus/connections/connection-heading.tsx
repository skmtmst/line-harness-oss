import Link from 'next/link'

import PageHeader from '@/components/shared/page-header'

/**
 * 切替のつながり画面の見出し。`page.tsx` は `PageHeader` の仕組みに
 * 寄せる決まり（本文に h1 を直書きしない）のため、V8 の見出しだけを
 * ここに置く。見た目は変えない。
 */
export default function ConnectionHeading({ group, v8 }: { group: { name: string }; v8: boolean }) {
  if (v8) {
    return (
      <div className="px-1 pt-1">
        <Link href="/rich-menus" className="text-action text-sm font-semibold no-underline hover:underline">← リッチメニューへ</Link>
        <h1 className="text-ink mt-1 text-xl font-bold">切替のつながり：{group.name}</h1>
        <p className="text-ink-secondary mt-1 text-sm">タブで行き来できるメニューの関係</p>
      </div>
    )
  }
  return (
    <PageHeader
      breadcrumb={[
        { label: 'リッチメニュー', href: '/rich-menus' },
        { label: group.name },
      ]}
      title="切替メニューのつながり"
      description={`${group.name} の切替先と戻り道を確認します。`}
    />
  )
}
