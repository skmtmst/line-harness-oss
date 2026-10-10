'use client'

/*
 * 「今日のお店」の右の列（E-1 `右の列`）：予約サイト・グルメ媒体・Google の口コミ・Instagram の新着。
 *
 * 媒体のリンク（店舗ページ・管理画面）は「予約サイト・グルメ媒体」の設定（/settings/booking-media）で保存した URL。
 * 保存してある行だけにリンクが出る。見出しの右の「設定」から、その設定の画面へ。
 * Instagram は投稿の同時公開まで対応（設定 › SNS 連携）。DM・コメントを受け取る口はまだ無いので案内だけ。
 */
import {RowActions} from '@/components/shared/row-actions'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import TextLink from '@/components/shared/text-link'
import type { GoogleConnectionData, GoogleReview } from '@/lib/restaurant-google-api'
import type {RestaurantRotation} from '@/lib/restaurant-test-api'
import type { StoreMedium } from './use-store-today'
import styles from './dashboard.module.css'

function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)))
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${rating}`
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (minutes < 60) return `${minutes}分前`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`
  return `${Math.floor(minutes / (60 * 24))}日前`
}

export function SidePanel({ media, google, latestReview, canWrite, now, rotation }: {
  rotation?:RestaurantRotation|null
  media: StoreMedium[] | null
  google: GoogleConnectionData | null
  latestReview: GoogleReview | null
  canWrite: boolean
  now: number
}) {
  const connected = google?.connection.status === 'connected'
  return (
    <div className={styles.side}>
      <Card padding="roomy" layout="vertical" gap="10px"><SectionHeader linkTone="action" title="今日の回転"/><div className={styles.rotation}>{[['稼働率',rotation?.utilization==null?'—':`${Math.round(rotation.utilization*100)}%`],['回転',rotation?.turnover==null?'—':`${rotation.turnover.toFixed(1)}回`],['滞在',rotation?.averageStayMinutes==null?'—':`${Math.round(rotation.averageStayMinutes)}分`],['無断取消',rotation?.noShowRate==null?'—':`${Math.round(rotation.noShowRate*100)}%`]].map(([label,value])=><div key={label}><span>{label}</span><strong title={value==='—'?'実測記録または営業時間がありません':undefined}>{value}</strong></div>)}</div></Card>
      <Card padding="roomy" layout="vertical" gap="12px">
      <SectionHeader linkTone="action"
        title="予約サイト・グルメ媒体" note={media?.some(m=>m.storePageUrl||m.adminUrl)?<RowActions subjectName="媒体のリンク" menuItems={media.flatMap(m=>[...(m.storePageUrl?[{id:m.code+'-page',label:`${m.name}の店舗ページ`,href:m.storePageUrl,external:true,onSelect:()=>{}}]:[]),...(m.adminUrl?[{id:m.code+'-admin',label:`${m.name}の管理画面`,href:m.adminUrl,external:true,onSelect:()=>{}}]:[])])}/>:undefined}
        href="/settings/booking-media"
        linkLabel="設定へ"
      />
      {media === null ? (
        <p className={styles.sideText}>読み込んでいます。</p>
      ) : media.length === 0 ? (
        <p className={styles.sideText}>予約を受け取っている媒体はまだありません。</p>
      ) : (
        <p className={styles.sideText}>{media.map(m=>m.name).join('・')}</p>
      )}

      </Card><Card padding="roomy" layout="vertical" gap="12px"><SectionHeader linkTone="action"
        title="Google の口コミ"
        href={connected ? '/restaurant-test/google' : undefined}
        linkLabel={connected ? 'すべて見る' : undefined}
      />
      {!google ? (
        <p className={styles.sideText}>Google の口コミを読み込めませんでした。</p>
      ) : !connected ? (
        <div className={styles.reviewBody}>
          <p className={styles.sideText}>Google ビジネスとつないでいません。つなぐと口コミがここに出ます。</p>
          <TextLink tone="action" href="/settings/sns">SNS 連携でつなぐ</TextLink>
        </div>
      ) : latestReview ? (
        <div className={styles.reviewBody}>
          <div className={styles.reviewHead}>
            <span className={styles.reviewStars}>{stars(latestReview.starRating)}</span>
            <span className={styles.reviewWho}>{`${latestReview.reviewerDisplayName ?? 'お客さま'} 様 ・ ${ago(latestReview.createTime, now)}`}</span>
            <span className={styles.stateSpacer} />
            <StatusBadge tone="danger">未返信</StatusBadge>
          </div>
          {latestReview.comment ? <p className={styles.reviewText}>{latestReview.comment}</p> : null}
          {canWrite ? (
            <Button variant="secondary" presentation="restaurant" href={`/restaurant-test/google?tab=reviews&view=draft&id=${encodeURIComponent(latestReview.id)}`}>
              返信する
            </Button>
          ) : null}
        </div>
      ) : (
        <p className={styles.sideText}>未返信の口コミはありません。</p>
      )}

      </Card><Card padding="roomy" layout="vertical" gap="12px"><SectionHeader linkTone="action"
        title="Instagram の新着"
        help="いまの Instagram 連携は、Googleビジネスの投稿を Instagram にも同時に出すところまでです。DM とコメントの新着は、受け取る口ができてからここに出します。"
        helpLabel="Instagram の新着の説明"
      />
      <div className={styles.reviewBody}>
        <p className={styles.sideText}>DM・コメントの新着はまだここに出せません。Instagram のつなぎ方は SNS 連携の画面で見られます。</p>
        <TextLink tone="action" href="/settings/sns">SNS 連携を見る</TextLink>
      </div>
      </Card>
    </div>
  )
}
