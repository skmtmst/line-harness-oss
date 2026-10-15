'use client'

import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'

export default function QrStoppedNotice({ onClose }: { onClose: () => void }) {
  return <Notice tone="danger">
    この経路は停止しています。QRコードと印刷は使えません。別の有効な経路を一覧から選んでください。
    <Button variant="text" onClick={onClose}>一覧に戻る</Button>
  </Notice>
}
