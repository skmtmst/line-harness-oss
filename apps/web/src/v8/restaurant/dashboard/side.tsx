'use client'

/*
 * 「今日のお店」の右の列（E-1 `右の列`）：予約サイト・グルメ媒体・Google の口コミ・Instagram の新着。
 *
 * 媒体のリンク（店舗ページ・管理画面）は「予約サイト・グルメ媒体」の設定（/settings/booking-media）で保存した URL。
 * 保存してある行だけにリンクが出る。見出しの右の「設定」から、その設定の画面へ。
 * Instagram はまだつなげないので「つなぐ」への案内だけ（SNS 連携の画面へ）。
 */
import { CornerUpLeft } from 'lucide-react'
import Button from '@/components/shared/button'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import TextLink from '@/components/shared/text-link'
import type { GoogleConnectionData, GoogleReview } from '@/lib/restaurant-google-api'
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

export function SidePanel({ media, google, latestReview, canWrite, now }: {
  media: StoreMedium[] | null
  google: GoogleConnectionData | null
  latestReview: GoogleReview | null
  canWrite: boolean
  now: number
}) {
  const connected = google?.connection.status === 'connected'
  return (
    <div className={styles.side}>
      <SectionHeader
        title="予約サイト・グルメ媒体"
        help="この店が予約を受け取っている媒体です。店舗ページ・管理画面のリンクは、媒体の設定で保存すると出ます。"
        helpLabel="予約サイト・グルメ媒体の説明"
        href="/settings/booking-media"
        linkLabel="設定へ"
      />
      {media === null ? (
        <p className={styles.sideText}>読み込んでいます。</p>
      ) : media.length === 0 ? (
        <p className={styles.sideText}>予約を受け取っている媒体はまだありません。</p>
      ) : (
        <ul className={styles.media}>
          {media.map((m) => (
            <li key={m.code} className={styles.medium}>
              <span className={styles.mediumMark} aria-hidden="true">{m.name.slice(0, 1)}</span>
              <span className={styles.mediumName} title={m.name}>{m.name}</span>
              {m.storePageUrl ? <a className={styles.mediumLink} href={m.storePageUrl} target="_blank" rel="noopener noreferrer">店舗ページ ↗</a> : null}
              {m.adminUrl ? <a className={styles.mediumLink} href={m.adminUrl} target="_blank" rel="noopener noreferrer">管理画面 ↗</a> : null}
            </li>
          ))}
        </ul>
      )}

      <SectionHeader
        title="Google の口コミ"
        help="Google ビジネスに届いた口コミのうち、まだ返信していない新しいものです。"
        helpLabel="Google の口コミの説明"
        href={connected ? '/restaurant-test/google' : undefined}
        linkLabel={connected ? 'すべて見る' : undefined}
      />
      {!google ? (
        <p className={styles.sideText}>Google の口コミを読み込めませんでした。</p>
      ) : !connected ? (
        <div className={styles.sideCard}>
          <p className={styles.sideText}>Google ビジネスとつないでいません。つなぐと口コミがここに出ます。</p>
          <TextLink href="/settings/sns">SNS 連携でつなぐ</TextLink>
        </div>
      ) : latestReview ? (
        <div className={styles.sideCard}>
          <div className={styles.reviewHead}>
            <span className={styles.reviewStars}>{stars(latestReview.starRating)}</span>
            <span className={styles.reviewWho}>{`${latestReview.reviewerDisplayName ?? 'お客さま'} 様 ・ ${ago(latestReview.createTime, now)}`}</span>
            <span className={styles.stateSpacer} />
            <StatusBadge tone="danger">未返信</StatusBadge>
          </div>
          {latestReview.comment ? <p className={styles.reviewText}>{latestReview.comment}</p> : null}
          {canWrite ? (
            <Button variant="text" href={`/restaurant-test/google?tab=reviews&view=draft&id=${encodeURIComponent(latestReview.id)}`}>
              <CornerUpLeft size={15} aria-hidden="true" />返信する
            </Button>
          ) : null}
        </div>
      ) : (
        <p className={styles.sideText}>未返信の口コミはありません。</p>
      )}

      <SectionHeader
        title="Instagram の新着"
        help="Instagram をつなぐと、DM とコメントの新着がここに出て、受信箱で LINE と同じように返せます。"
        helpLabel="Instagram の新着の説明"
      />
      <div className={styles.sideCard}>
        <p className={styles.sideText}>Instagram はまだつないでいません。つなぐと DM・コメントの新着がここに出ます。</p>
        <TextLink href="/settings/sns">SNS 連携を見る</TextLink>
      </div>
    </div>
  )
}
