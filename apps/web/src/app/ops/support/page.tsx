'use client'

import OpsPageHeader from '@/components/ops/ops-page-header'

/** お問い合わせ（★V6 37）。第2段で作る。いまは案内だけ。 */
export default function OpsPlaceholderPage() {
  return (
    <div>
      <OpsPageHeader title="お問い合わせ" />
      <div className="rounded-md border border-hairline bg-canvas px-6 py-10 text-center text-label text-ink-secondary">
        この画面は第2段で作ります。いまは契約先アカウント・監査ログ・メンバー管理が使えます。
      </div>
    </div>
  )
}
