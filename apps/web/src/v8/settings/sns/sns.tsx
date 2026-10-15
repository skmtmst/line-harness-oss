'use client'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { ArrowRight, Check, Link2, RefreshCw } from 'lucide-react'
import type { InstagramConnectionStatus } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import HelpTip from '@/components/shared/help-tip'
import Checkbox from '@/components/shared/checkbox'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle, usePageCrumbs, useHideSettingsNav } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { restaurantGoogleApi, type GoogleConnectionData } from '@/lib/restaurant-google-api'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import styles from './sns.module.css'
import { formatDate } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'


/**
 * ★V8-B 設定 › SNS 連携（`YINmJ` 未接続 ／ `DFnll` Instagram 接続済み、2026-10-07 利用者承認）。
 *
 * Googleビジネスと Instagram を1列のカードで縦に並べる。
 * Instagram は「Instagram にログインして接続」だけで繋がる（ページを選ぶ段は無い）。
 * 繋ぐ目的は Googleビジネスの投稿を Instagram へ同時に出すこと。
 */

/* lucide には Instagram の印が無いので、写真の印（Camera）を使う。 */

const GOOGLE_BADGE: Record<string, { label: string; tone: StatusBadgeTone }> = {
  connected: { label: 'つながっている', tone: 'success' },
  pending_location: { label: '店舗を選んでいません', tone: 'warning' },
  expired: { label: '認可が切れています', tone: 'warning' },
  no_permission: { label: '権限がありません', tone: 'warning' },
  disconnected: { label: 'まだつないでいません', tone: 'neutral' },
}

const IG_BADGE: Record<InstagramConnectionStatus['state'], { label: string; tone: StatusBadgeTone }> = {
  connected: { label: 'つながっている', tone: 'success' },
  disconnected: { label: 'まだつないでいません', tone: 'neutral' },
  expired: { label: '認可が切れています', tone: 'warning' },
  unconfigured: { label: '設定がありません', tone: 'neutral' },
}

const IG_CAPABILITIES = ['DM を受信箱で読む・返す', '投稿へのコメントに返す', '投稿を予約する', 'プロフィールのリンクを LINE の友だち追加へ向ける']

/* 受信箱での見え方の見本（実際のデータではない）。 */
const SAMPLE_INBOX = [
  { name: '@yuki_gourmet', kind: 'Instagram の DM', state: '未対応', tone: 'danger' as StatusBadgeTone, owner: '担当：なし', text: '金曜 20時に4名で入れますか？', at: '01/13 18:02', route: 'Instagram' },
  { name: '鈴木 美咲', kind: 'LINE の友だち', state: '対応済み', tone: 'success' as StatusBadgeTone, owner: '担当：Kenta', text: '明日 19時、2名で予約できますか', at: '01/13 17:40', route: 'LINE' },
]

/** 戻り先（`/settings/sns?instagram=…`）で出す案内。Worker の折り返しが付ける。 */
const FLASH: Record<string, { tone: 'success' | 'danger'; text: string }> = {
  connected: { tone: 'success', text: 'Instagram とつながりました。Googleビジネスの投稿を Instagram にも出せます。' },
  failed: { tone: 'danger', text: 'Instagram とつなげませんでした。ビジネスアカウント（またはクリエイターアカウント）でログインして、もう一度お試しください。' },
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowSpacer} />
      <span className={styles.rowValue}>{value}</span>
    </div>
  )
}

export default function SnsSettingsPage() {
  const saveErrors = useSaveFormErrors()
  usePageTitle('SNS 連携')
  usePageCrumbs([{ label: '設定', href: '/settings' }])
  useHideSettingsNav()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canManage = canManageRole(role)

  const [google, setGoogle] = useState<GoogleConnectionData | null>(null)
  const [googleError, setGoogleError] = useState<unknown>(null)
  const [instagram, setInstagram] = useState<InstagramConnectionStatus | null>(null)
  const [instagramError, setInstagramError] = useState<unknown>(null)
  const [confirm, setConfirm] = useState<'google' | 'instagram' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const flashKey = searchParams.get('instagram') ?? ''
  const flash = FLASH[flashKey] ?? null

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    const accountId = selectedAccountId
    await Promise.all([
      restaurantGoogleApi.connection(accountId)
        .then((res) => { setGoogle(res); setGoogleError(null) })
        .catch((caught) => { setGoogle(null); setGoogleError(caught) }),
      api.instagram.connection(accountId)
        .then((res) => {
          if (!res.success) { setInstagram(null); setInstagramError(new Error(res.error)); return }
          setInstagram(res.data)
          setInstagramError(null)
        })
        .catch((caught) => { setInstagram(null); setInstagramError(caught) }),
    ])
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const googleStatus = google?.connection.status ?? null
  const googleConnected = googleStatus !== null && googleStatus !== 'disconnected'
  const igState = instagram?.state ?? null
  const igConnection = instagram?.connection ?? null

  const connectInstagram = async () => {
    if (!selectedAccountId) return
    setBusy(true)
    setActionError('')
    try {
      const res = await api.instagram.start(selectedAccountId)
      if (!res.success) throw new Error(res.error)
      window.location.href = res.data.url
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)
      setBusy(false)
      { if (!fieldFailure)
      setActionError('Instagram のログイン画面を開けませんでした。もう一度お試しください。') }
    }
  }

  const checkInstagram = async () => {
    if (!selectedAccountId) return
    setBusy(true)
    setActionError('')
    try {
      await api.instagram.refresh(selectedAccountId)
      await load()
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)
      setActionError('接続を確かめられませんでした。もう一度お試しください。') }
    } finally {
      setBusy(false)
    }
  }

  const runDisconnect = async () => {
    if (!selectedAccountId) return
    setBusy(true)
    setActionError('')
    try {
      if (confirm === 'google') {
        await restaurantGoogleApi.disconnect(selectedAccountId)
      } else {
        await api.instagram.disconnect(selectedAccountId, igConnection?.version ?? 0)
      }
      setConfirm(null)
      await load()
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)
      setActionError(confirm === 'google'
        ? 'Googleビジネスの接続を解除できませんでした。もう一度お試しください。'
        : 'Instagram の接続を解除できませんでした。もう一度お試しください。') }
    } finally {
      setBusy(false)
    }
  }

  const googleBadge = googleError || !google ? null : GOOGLE_BADGE[google.connection.status] ?? GOOGLE_BADGE.disconnected
  const igBadge = igState ? IG_BADGE[igState] : null
  const googleLocation = google?.connection.locationTitle ?? google?.store.name ?? null

  return (
    <SaveErrorScope errors={saveErrors}><PageFrame kind="list" boardId="y3GGTs">
      <PageHeading
        headingSize="compact"
        title="SNS 連携"
        help="Googleビジネスや Instagram とつないで、お店の情報をまとめて発信します。"
      />
      <div className={styles.body}>
        {flash ? (
          <Notice tone={flash.tone} role="status" onClose={() => router.replace('/settings/sns', { scroll: false })}>
            {flash.text}
          </Notice>
        ) : null}
        {actionError ? <Notice tone="danger" role="alert">{actionError}</Notice> : null}

        <section className={styles.card} aria-labelledby="sns-google-title">
          <div className={styles.cardHead}>
            <span className={styles.mark} aria-hidden>G</span>
            <h2 id="sns-google-title" className={styles.cardTitle}>Google ビジネス</h2>
            <span className={styles.rowSpacer} />
            {googleBadge ? <StatusBadge tone={googleBadge.tone} size="compact">{googleBadge.label}</StatusBadge> : null}
            {googleConnected && canManage ? (
              <RowActions menuAppearance="box" menuSize="row" subjectName="Google ビジネスの連携"
                destructiveItem={{ id: 'disconnect', label: '接続を解除する', onSelect: () => { setActionError(''); setConfirm('google') } }} />
            ) : null}
          </div>
          {googleError ? (
            <ListState kind="error" error={googleError} onRetry={() => void load()} />
          ) : !google ? (
            <ListState kind="loading" />
          ) : (
            <>
              <Row label="店舗" value={googleLocation ?? '—'} />
              <Row label="最終同期" value={formatDate(google.connection.lastSyncedAt, { style: 'detail', fallback: '—' })} />
              <Row label="口コミ" value={google.summary.storedCount > 0 ? `${google.summary.storedCount}件・未返信 ${google.summary.unrepliedCount}件` : '—'} />
              <Row label="投稿" value={google.summary.postsAttentionCount > 0 ? `要対応 ${google.summary.postsAttentionCount}件` : '—'} />
              <div className={styles.links}>
                <Link className={styles.link} href="/restaurant-test/google?tab=reviews">口コミへ<ArrowRight size={14} aria-hidden /></Link>
                <Link className={styles.link} href="/restaurant-test/google?tab=posts">投稿へ<ArrowRight size={14} aria-hidden /></Link>
                <Link className={styles.link} href="/restaurant-test/google?tab=settings">プロフィールへ<ArrowRight size={14} aria-hidden /></Link>
              </div>
            </>
          )}
        </section>

        <section className={styles.card} aria-labelledby="sns-instagram-title">
          <div className={styles.cardHead}>
            <span className={styles.mark} aria-hidden>IG</span>
            <h2 id="sns-instagram-title" className={styles.cardTitle}>Instagram</h2>
            <span className={styles.rowSpacer} />
            {igBadge ? <StatusBadge tone={igBadge.tone} size="compact">{igBadge.label}</StatusBadge> : null}
            {(igState === 'connected' || igState === 'expired') && canManage ? (
              <RowActions menuAppearance="box" menuSize="row" subjectName="Instagram の連携"
                destructiveItem={{ id: 'disconnect', label: '接続を解除する', onSelect: () => { setActionError(''); setConfirm('instagram') } }} />
            ) : null}
          </div>
          {instagramError ? (
            <ListState kind="error" error={instagramError} onRetry={() => void load()} />
          ) : !igState ? (
            <ListState kind="loading" />
          ) : (
            <>
              {igState === 'connected' && igConnection ? (
                <Row
                  label="接続しているアカウント"
                  value={igConnection.username ? `@${igConnection.username}（ビジネス）` : igConnection.pageName || emptyValue('unknown')}
                />
              ) : null}
              <p className={styles.listTitle}>{igState === 'connected' ? 'できること' : 'つなぐとできること'}</p>
              <ul className={styles.checks}>
                {IG_CAPABILITIES.map((text) => <li key={text}><Check size={14} aria-hidden />{text}</li>)}
              </ul>
              {igState === 'unconfigured' ? (
                <p className={styles.note}>この環境には Instagram 接続の設定がありません。</p>
              ) : null}
              {canManage && igState !== 'unconfigured' ? (
                <div className={styles.actions}>
                  {igState === 'connected' ? (
                    <Button variant="secondary" onClick={() => void checkInstagram()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">
                      <RefreshCw size={15} />
                      接続を確かめる
                    </Button>
                  ) : (
                    <>
                      <Button variant="primary" onClick={() => void connectInstagram()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">
                        <Link2 size={15} aria-hidden />
                        Instagram とつなぐ
                      </Button>
                      <span className={styles.note}>プロアカウント（ビジネス）が必要です。個人のアカウントは接続できません。</span>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className={styles.sample} aria-labelledby="sns-sample-title">
          <h2 id="sns-sample-title" className={styles.sampleTitle}>受信箱での見え方（見本）<HelpTip label="受信箱での見え方の説明">Instagram の DM をつなぐと、LINE の友だちと同じ受信箱に並びます。ここは見え方の見本で、実際のデータではありません。</HelpTip></h2>
          <DataTable className={styles.sampleTable} columnSizing="controls" label="受信箱での見え方（見本）">
            <thead><TableHeadRow>
              <Th className={styles.colCheck}><span className="sr-only">選択</span></Th>
              <Th className={styles.colWho}>相手</Th>
              <Th className={styles.colState}>対応・担当</Th>
              <Th grow>最新のメッセージ</Th>
              <Th className={styles.colRoute}>経路</Th>
              <Th className={styles.colLast}>最終接触</Th>
            </TableHeadRow></thead>
            <tbody>
              {SAMPLE_INBOX.map((row) => <Tr key={row.name}>
                <Td><Checkbox checked={false} onCheckedChange={() => {}} disabled aria-label={`${row.name}（見本）`} /></Td>
                <Td><span className={styles.who}><span className={styles.face} aria-hidden>山</span><span className={styles.whoText}><strong>{row.name}</strong><small>{row.kind}</small></span></span></Td>
                <Td><span className={styles.whoText}><StatusBadge tone={row.tone} size="compact">{row.state}</StatusBadge><small>{row.owner}</small></span></Td>
                <Td><span className={styles.whoText}><span>{row.text}</span><small>{row.at}</small></span></Td>
                <Td><StatusBadge tone="info" size="compact">{row.route}</StatusBadge></Td>
                <Td>今日</Td>
              </Tr>)}
            </tbody>
          </DataTable>
        </section>
      </div>

      <ConfirmDialog
        open={confirm === 'google'}
        destructive
        title="Googleビジネスの接続を解除しますか？"
        description="解除すると、口コミの取り込みと投稿の公開が止まります。あとでもう一度つなぎ直せます。"
        confirmLabel="解除する"
        busy={busy}
        onConfirm={() => runDisconnect()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'instagram'}
        destructive
        title="Instagram の接続を解除しますか？"
        description="解除すると、Googleビジネスの投稿を Instagram へ同時に出せなくなります。あとでもう一度つなぎ直せます。"
        confirmLabel="解除する"
        busy={busy}
        onConfirm={() => runDisconnect()}
        onCancel={() => setConfirm(null)}
      />
    </PageFrame></SaveErrorScope>
  )
}
