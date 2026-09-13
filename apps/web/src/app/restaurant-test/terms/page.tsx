'use client'

import Link from 'next/link'
import TermsDocumentContent from '@/components/legal/terms-document'
import { TERMS_IS_DRAFT } from '@/content/terms/musubo-terms'
import { usePageTitle } from '@/components/shell/page-chrome'

export default function RestaurantTermsPage() {
  usePageTitle('利用規約')

  return <div>
    <div className="mb-5 flex justify-end">
      <Link href="/restaurant-test/stores/new" className="text-sm font-semibold text-action">店舗追加へ戻る</Link>
    </div>
    {TERMS_IS_DRAFT && <div className="mb-5 rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
      これは開発中の仮の利用規約です。正式版の公開時に、あらためて同意をお願いします。
    </div>}
    <div className="mx-auto max-w-4xl rounded-card border border-hairline bg-canvas p-5 sm:p-8">
      <TermsDocumentContent />
    </div>
  </div>
}
