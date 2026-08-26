'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '../shared/tabs'
import styles from './merged-tabs.module.css'

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
  variant = 'underline',
  disabledKeys = [],
}: {
  basePath: string
  /** クエリの名前。受信箱だけ channel を使う。 */
  paramName?: string
  tabs: readonly MergedTab[]
  active: string
  /**
   * クエリ無しで開いたときのタブ。省略すると先頭。
   *
   * 設計側のタブの並びと、その画面の主役が一致しないことがある
   * （成果とアフィリエイトは「成果地点（CV）」が主役だが、設計の並びでは4番目）。
   * 並びを設計に合わせたまま、素のURLで主役を開けるようにする。
   */
  defaultKey?: string
  variant?: 'underline' | 'segmented'
  disabledKeys?: readonly string[]
}) {
  const router = useRouter()
  const home = defaultKey ?? tabs[0].key

  const goTo = (tab: MergedTab) => {
    router.replace(
      tab.href ?? (tab.key === home ? basePath : `${basePath}?${paramName}=${tab.key}`),
    )
  }

  if (variant === 'underline') {
    return (
      <Tabs
        className={styles.shared}
        items={tabs.map((tab) => ({
          label: tab.label,
          current: active === tab.key,
          disabled: disabledKeys.includes(tab.key),
          onClick: () => goTo(tab),
        }))}
      />
    )
  }

  return (
    <div
      className={variant === 'segmented' ? styles.segmented : styles.root}
      role="tablist"
      data-design-node={variant === 'segmented' ? 'z9TQJ' : 'VPn1F ISA1Q'}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          disabled={disabledKeys.includes(t.key)}
          onClick={() =>
            // 既定のタブはクエリを付けずに素のパスへ戻す。
            // ?tab=xxx が residue として残ると、共有したURLが分かりにくい。
            goTo(t)
          }
          className={`${styles.tab} ${variant === 'segmented' ? styles.segmentedTab : ''} ${active === t.key ? `${styles.selected} ${variant === 'segmented' ? styles.segmentedSelected : ''}` : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** クエリから今のタブを読む。知らない値は既定（省略時は先頭）のタブに寄せる。 */
export function useMergedTab(
  tabs: readonly MergedTab[],
  paramName = 'tab',
  defaultKey?: string,
): string {
  const params = useSearchParams()
  const raw = params.get(paramName)
  return tabs.find((t) => t.key === raw)?.key ?? defaultKey ?? tabs[0].key
}
