'use client'

/** B-201：流入・クーポンも正本のQR窓を使う。停止経路は保存を止める。 */
import DashboardQrDialog from '@/components/dashboard/qr-dialog'
import { api } from '@/lib/api'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export const referralUrl = (refCode: string) => `${WORKER_BASE.replace(/\/$/, '')}/r/${encodeURIComponent(refCode)}`

export interface QrRoute {
  refCode: string
  name: string
  genre: string | null
  /** false（停止中）のときは QR・保存を止める。null は未登録 ref（有効・無効の概念が無い）。 */
  isActive: boolean | null
  /** entry_routes の ID。あるときだけ印刷用 PDF を出せる。 */
  id?: string
  couponEnabled?: boolean
}

export default function QrDialog({ route, onClose }: { route: QrRoute; onClose: () => void }) {
  return <DashboardQrDialog open onClose={onClose} accountName={route.name}
    baseLink={referralUrl(route.refCode)} routes={[]}
    resource={{
      url: referralUrl(route.refCode), title: `${route.name} の QR コード`,
      stopped: route.isActive === false,
      description: 'チラシ・店頭POPに印刷して使えます。読み取るとこの経路の画面が開きます。',
      downloadPdf: route.id ? paper => route.couponEnabled ? api.entryRoutes.qrPdf(route.id!, paper) : api.entryRoutes.qrPdf(route.id!) : undefined,
      downloadImage: route.id && route.couponEnabled ? (format, size) => api.entryRoutes.qrImage(route.id!, format as 'png' | 'svg', size as 'small' | 'medium' | 'large') : undefined,
      paperSizes: route.couponEnabled,
      ...(route.couponEnabled ? {
        formats: [{value:'png',label:'PNG'},{value:'svg',label:'SVG'}],
        sizes: [{value:'small',label:'小 256'},{value:'medium',label:'中 512'},{value:'large',label:'大 1024'}],
      } : {}),
    }} />
}
