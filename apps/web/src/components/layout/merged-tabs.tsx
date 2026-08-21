'use client'

import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 関連する画面をURL付きで切り替える共通タブ。
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
  /**
   * 別ルートに実体があるタブの行き先。
   * 「検索からの流入」だけは /search-console に画面がある。
   */
  href?: string
}

export default function MergedTabs({
  basePath,
  paramName = 'tab',
  tabs,
  active,
  defaultKey,
}: {
  basePath: string
  /** クエリの名前。受信箱だけ channel を使う。 */
  paramName?: string
  tabs: MergedTab[]
  active: string
  /**
   * クエリ無しで開いたときのタブ。省略すると先頭。
   *
   * 設計側のタブの並びと、その画面の主役が一致しないことがある
   * （成果とアフィリエイトは「成果地点（CV）」が主役だが、設計の並びでは4番目）。
   * 並びを設計に合わせたまま、素のURLで主役を開けるようにする。
   */
  defaultKey?: string
}) {
  const router = useRouter()
  const home = defaultKey ?? tabs[0].key
  return (
    <div className="border-hairline mb-5 flex flex-wrap gap-1 border-b">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() =>
            // 既定のタブはクエリを付けずに素のパスへ戻す。
            // ?tab=xxx が residue として残ると、共有したURLが分かりにくい。
            router.replace(
              t.href ?? (t.key === home ? basePath : `${basePath}?${paramName}=${t.key}`),
            )
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

/** クエリから今のタブを読む。知らない値は既定（省略時は先頭）のタブに寄せる。 */
export function useMergedTab(
  tabs: MergedTab[],
  paramName = 'tab',
  defaultKey?: string,
): string {
  const params = useSearchParams()
  const raw = params.get(paramName)
  return tabs.find((t) => t.key === raw)?.key ?? defaultKey ?? tabs[0].key
}
