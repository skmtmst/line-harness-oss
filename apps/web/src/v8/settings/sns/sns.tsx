'use client'

/*
 * ★V8 SNS 連携（提案 E-6 `y3GGTs`。設定の中）。Google ビジネスと Instagram の2つだけ（X は入れない）。
 *
 * Google ビジネス：今ある接続の口（restaurant-test/google/connection）で、つながっているか・店舗名・最終同期・
 * 口コミ・投稿を出し、口コミ／投稿／プロフィールへ。つないでいなければ Google ビジネスの設定へ。
 * Instagram：まだつなげない（口が無い）。つなぐとできること4つを出し、［Instagram とつなぐ］は押せる形のまま
 * 「まだ使えません」の案内を出す（「準備中」の言い回しは決まり §5 で使わない）。閲覧のみには［つなぐ］を置かない。動きは BEHAVIOR.md。
 */
import { useEffect, useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import TextLink from '@/components/shared/text-link'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { useHideSettingsNav, usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { restaurantGoogleApi, type GoogleConnectionData } from '@/lib/restaurant-google-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import styles from './sns.module.css'

const GOOGLE_STATE: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  connected: { label: 'つながっている', tone: 'success' },
  pending_location: { label: '店舗を選んでいません', tone: 'warning' },
  expired: { label: '認可切れ', tone: 'danger' },
  no_permission: { label: '権限なし', tone: 'danger' },
  disconnected: { label: 'つないでいません', tone: 'neutral' },
}

export const INSTAGRAM_CAN = [
  'DM を受信箱で読む・返す',
  '投稿へのコメントに返す',
  '投稿を予約する',
  'プロフィールのリンクを LINE の友だち追加へ向ける',
]

function stamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const day = new Date(iso)
  const today = new Date()
  const hm = `${day.getHours()}:${String(day.getMinutes()).padStart(2, '0')}`
  return day.toDateString() === today.toDateString() ? `今日 ${hm}` : `${day.getMonth() + 1}月${day.getDate()}日 ${hm}`
}

function GoogleCard({ data, error, canManage }: { data: GoogleConnectionData | null; error: unknown; canManage: boolean }) {
  if (error && !data) return <section className={styles.card}><ListState kind="error" error={error} onRetry={() => window.location.reload()} /></section>
  if (!data) return <section className={styles.card}><ListState kind="loading" /></section>
  const { connection, summary } = data
  const state = GOOGLE_STATE[connection.status] ?? GOOGLE_STATE.disconnected
  const connected = connection.status === 'connected'
  return (
    <section className={styles.card} aria-labelledby="sns-google">
      <div className={styles.cardHead}>
        <span className={styles.mark} aria-hidden="true">G</span>
        <h2 id="sns-google" className={styles.cardTitle}>Google ビジネス</h2>
        <span className={styles.spacer} />
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        {canManage ? (
          <RowActions
            subjectName="Google ビジネス"
            menuItems={[{ id: 'settings', label: '接続の設定を開く', external: true, onSelect: () => { window.location.href = '/restaurant-test/google?tab=settings' } }]}
          />
        ) : null}
      </div>
      {connected || connection.status === 'expired' || connection.status === 'no_permission' ? (
        <dl className={styles.facts}>
          <div className={styles.fact}><dt>店舗</dt><dd>{connection.locationTitle ?? data.store.name}</dd></div>
          <div className={styles.fact}><dt>最終同期</dt><dd>{stamp(connection.lastSyncedAt)}</dd></div>
          <div className={styles.fact}><dt>口コミ</dt><dd>{`★${connection.averageRating ?? '—'}（${connection.totalReviewCount ?? 0}件）・未返信 ${summary.unrepliedCount}件`}</dd></div>
          <div className={styles.fact}><dt>投稿</dt><dd>{summary.postsAttentionCount ? `確かめる投稿 ${summary.postsAttentionCount}件` : '確かめる投稿はありません'}</dd></div>
        </dl>
      ) : (
        <p className={styles.text}>{connection.status === 'pending_location' ? 'Google アカウントの認可は済んでいます。つなぐ店舗を選んでください。' : 'Google ビジネスとつなぐと、口コミ・投稿・プロフィールをこの管理画面で扱えます。'}</p>
      )}
      <div className={`${styles.links} ${styles.linksWide}`}>
        {connected ? (
          <>
            <TextLink href="/restaurant-test/google?tab=reviews">口コミへ</TextLink>
            <TextLink href="/restaurant-test/google?tab=posts">投稿へ</TextLink>
            <TextLink href="/restaurant-test/google?tab=profile">プロフィールへ</TextLink>
          </>
        ) : canManage && data.permissions.canManageConnection ? (
          <Button variant="primary" href="/restaurant-test/google?tab=settings"><Link2 size={15} aria-hidden="true" />{connection.status === 'pending_location' ? '店舗を選ぶ' : 'Google とつなぐ'}</Button>
        ) : (
          <TextLink href="/restaurant-test/google?tab=settings">Google ビジネスの設定を見る</TextLink>
        )}
      </div>
    </section>
  )
}

function InstagramCard({ canManage }: { canManage: boolean }) {
  const [asked, setAsked] = useState(false)
  return (
    <section className={`${styles.card} ${styles.cardInstagram}`} aria-labelledby="sns-instagram">
      <div className={styles.cardHead}>
        <span className={styles.mark} aria-hidden="true">IG</span>
        <h2 id="sns-instagram" className={styles.cardTitle}>Instagram</h2>
        <span className={styles.spacer} />
        <StatusBadge tone="neutral">まだつないでいません</StatusBadge>
      </div>
      <p className={styles.subTitle}>つなぐとできること</p>
      <ul className={styles.checks}>
        {INSTAGRAM_CAN.map((item) => (
          <li key={item} className={styles.check}><Check size={16} aria-hidden="true" className={styles.checkIcon} />{item}</li>
        ))}
      </ul>
      {canManage ? (
        <div className={styles.links}>
          <Button variant="primary" onClick={() => setAsked(true)} aria-describedby="sns-instagram-note"><Link2 size={15} aria-hidden="true" />Instagram とつなぐ</Button>
          <span id="sns-instagram-note" className={styles.note}>プロアカウント（ビジネス）が必要です</span>
        </div>
      ) : null}
      {canManage && asked ? (
        <Notice tone="info" role="status">Instagram とつなぐ機能は、まだ使えません。使えるようになったら、このボタンからつなげます。</Notice>
      ) : null}
    </section>
  )
}

/** 受信箱での見え方の見本（絵の「見本」の表）。実際の受信箱のデータではない。 */
const SAMPLE_ROWS = [
  { face: 'Y', who: '@yuki_gourmet', sub: 'Instagram の DM', state: '未対応', tone: 'danger' as const, owner: '担当：なし', text: '金曜 20時に4名で入れますか？', at: '18:02', route: 'Instagram', last: '今日' },
  { face: '鈴', who: '鈴木 美咲', sub: 'LINE の友だち', state: '対応済み', tone: 'success' as const, owner: '担当：Kenta', text: '明日 19時、2名で予約できますか', at: '17:40', route: 'LINE', last: '今日' },
]

export default function SnsSettingsPage() {
  usePageTitle('SNS 連携')
  usePageCrumbs([{ label: '設定', href: '/settings' }])
  /* 絵（y3GGTs）には設定の中のメニューが無い。この画面だけ出さない。 */
  useHideSettingsNav()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
  const [google, setGoogle] = useState<GoogleConnectionData | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let current = true
    if (!selectedAccountId) return
    void restaurantGoogleApi.connection(selectedAccountId)
      .then((res) => { if (current) { setGoogle(res); setError(null) } })
      .catch((caught) => { if (current) setError(caught) })
    return () => { current = false }
  }, [selectedAccountId])

  return (
    <PageFrame kind="list" boardId="y3GGTs">
      <PageHeading
        headingSize="compact"
        title="SNS 連携"
        help="Google ビジネスと Instagram をつなぎます。つないだ Instagram の DM は受信箱に「Instagram」の札付きで並び、LINE と同じ場所で返せます。"
      />
      <div className={styles.body}>
        <div className={styles.cards}>
          <GoogleCard data={google} error={error} canManage={canManage} />
          <InstagramCard canManage={canManage} />
        </div>
        <div className={styles.sample}>
          <SectionHeader
            title="受信箱での見え方（見本）"
            help="Instagram をつないだあとの受信箱の並び方の見本です。表の中身は例で、実際のメッセージではありません。"
            helpLabel="受信箱での見え方の説明"
          />
          <DataTable className={styles.table} data-design="sns-inbox-sample">
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colWho}>相手</Th>
                <Th className={styles.colState}>対応・担当</Th>
                <Th className={styles.colText}>最新のメッセージ</Th>
                <Th className={styles.colRoute}>経路</Th>
                <Th className={styles.colLast}>最終接触</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {SAMPLE_ROWS.map((row) => (
                <Tr key={row.who} className={styles.row} data-table-layout="columns">
                  <Td className={styles.colWho}>
                    <span className={styles.whoCell}>
                      <span className={styles.face} aria-hidden="true">{row.face}</span>
                      <span className={styles.whoText}><span className={styles.who}>{row.who}</span><span className={styles.whoSub}>{row.sub}</span></span>
                    </span>
                  </Td>
                  <Td className={styles.colState}><span className={styles.stateCell}><StatusBadge tone={row.tone}>{row.state}</StatusBadge><span className={styles.owner}>{row.owner}</span></span></Td>
                  <Td className={styles.colText}><span className={styles.message}>{row.text}</span><span className={styles.owner}>{`今日 ${row.at}`}</span></Td>
                  <Td className={styles.colRoute}><span className={styles.route}>{row.route}</span></Td>
                  <Td className={styles.colLast}><span className={styles.last}>{row.last}</span></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </div>
    </PageFrame>
  )
}
