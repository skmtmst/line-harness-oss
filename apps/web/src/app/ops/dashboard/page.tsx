'use client'

import OpsPageHeader from '@/components/ops/ops-page-header'

/** ダッシュボード（★V6 37）。第3段で作る。いまは案内だけ。 */
export default function OpsPlaceholderPage() {
  return (
    <div>
      <OpsPageHeader title="ダッシュボード" />
      <div className="rounded-md border border-hairline bg-canvas px-6 py-10 text-center text-label text-ink-secondary">
        この画面は第3段で作ります。いまは契約先アカウント・監査ログ・メンバー管理が使えます。
      </div>
    </div>
  )
}
