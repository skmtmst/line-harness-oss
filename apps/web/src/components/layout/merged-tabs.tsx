'use client'

import { useRouter, useSearchParams } from 'next/navigation'

/**
 * V2で統合した画面のタブ。
 *
 * 旧ルート（/duplicates など）は消さずに 308 で飛ばしている
 * （apps/web/public/_redirects）。ブックマーク・社内Wiki・LINEの
 * リッチメニューから旧URLを踏んでいる可能性があるため。
 *
 * タブの状態はURLに出す。出さないと、ブラウザバックで前のタブに戻れず、
 * 「このタブを見て」と誰かに送ることもできない。
 */

export interface MergedTab {
  key: string
  label: string
}

export default function MergedTabs({
  basePath,
  paramName = 'tab',
  tabs,
  active,
}: {
  basePath: string
  /** クエリの名前。受信箱だけ channel を使う。 */
  paramName?: string
  tabs: MergedTab[]
  active: string
}) {
  const router = useRouter()
  return (
    <div className="border-hairline mb-5 flex flex-wrap gap-1 border-b">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          onClick={() =>
            // 先頭のタブは既定なので、クエリを付けずに素のパスへ戻す。
            // ?tab=xxx が residue として残ると、共有したURLが分かりにくい。
            router.replace(i === 0 ? basePath : `${basePath}?${paramName}=${t.key}`)
          }
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === t.key
              ? 'border-accent text-accent'
              : 'text-ink-secondary hover:text-ink border-transparent'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** クエリから今のタブを読む。知らない値は先頭のタブに寄せる。 */
export function useMergedTab(tabs: MergedTab[], paramName = 'tab'): string {
  const params = useSearchParams()
  const raw = params.get(paramName)
  return tabs.find((t) => t.key === raw)?.key ?? tabs[0].key
}
