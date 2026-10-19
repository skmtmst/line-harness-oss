'use client'

import Notice from '@/components/shared/notice'

/* 窓の中に戻るリンクは置かない（戻るはパンくずと［キャンセル］・窓の閉じるだけ。）。 */
export default function QrStoppedNotice(_props: { onClose?: () => void }) {
  return <Notice tone="danger">
    この経路は停止しています。QRコードと印刷は使えません。別の有効な経路を選んでください。
  </Notice>
}
