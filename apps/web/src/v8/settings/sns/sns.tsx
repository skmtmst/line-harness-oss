'use client'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { ArrowRight, Check, Link2, RefreshCw } from 'lucide-react'
import type { InstagramConnectionStatus } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { CustomerInfoRows } from '@/components/shared/customer-info-rows'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StatusBadge from '@/components/shared/status-badge'
import { GOOGLE_CONNECTION_STATUS, INSTAGRAM_CONNECTION_STATUS } from '@/lib/status-labels'
import { RowActions } from '@/components/shared/row-actions'
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

const IG_CAPABILITIES = ['DM を受信箱で読む・返す', '投稿へのコメントに返す', '投稿を予約する', 'プロフィールのリンクを LINE の友だち追加へ向ける']

/** 戻り先（`/settings/sns?instagram=…`）で出す案内。Worker の折り返しが付ける。 */
const FLASH: Record<string, { tone: 'success' | 'danger'; text: string }> = {
  connected: { tone: 'success', text: 'Instagram とつながりました。Googleビジネスの投稿を Instagram にも出せます。' },
  failed: { tone: 'danger', text: 'Instagram とつなげませんでした。ビジネスアカウント（またはクリエイターアカウント）でログインして、もう一度お試しください。' },
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
  const [confirm, setConfirm] = useState<'instagram' | null>(null)
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
          // 返事は成功でも中身の形が違うことがある。読み込み中のまま止めず、失敗の表示を出す。
          if (!res.success || !res.data?.state) { setInstagram(null); setInstagramError(new Error(res.success ? 'Instagram の接続の状態を読み取れませんでした。' : res.error)); return }
          setInstagram(res.data)
          setInstagramError(null)
        })
        .catch((caught) => { setInstagram(null); setInstagramError(caught) }),
    ])
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const googleStatus = google?.connection.status ?? null
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
      await api.instagram.disconnect(selectedAccountId, igConnection?.version ?? 0)
      setConfirm(null)
      await load()
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)
      setActionError('Instagram の接続を解除できませんでした。もう一度お試しください。') }
    } finally {
      setBusy(false)
    }
  }

  const googleBadgeInfo = googleError || !google ? null : GOOGLE_CONNECTION_STATUS[google.connection.status] ?? GOOGLE_CONNECTION_STATUS.disconnected
  const igStatus = igState ? INSTAGRAM_CONNECTION_STATUS[igState] : null
  const googleLocation = google?.connection.locationTitle ?? google?.store.name ?? null

  return (
    <SaveErrorScope errors={saveErrors}><PageFrame kind="settings" boardId="y3GGTs">
      <PageHeading
        headingSize="compact"
        title="SNS 連携"
        help="Googleビジネスや Instagram とつないで、お店の情報をまとめて発信します。"
      />
      <div className={styles.body}>
        {role !== null && !canManage ? <ReadOnlyNotice /> : null}
        {flash ? (
          <Notice tone={flash.tone} role="status" onClose={() => router.replace('/settings/sns', { scroll: false })}>
            {flash.text}
          </Notice>
        ) : null}
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

        <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-labelledby="sns-google-title">
          <div className={styles.cardHead}>
            <span className={styles.mark} aria-hidden>G</span>
            <h2 id="sns-google-title" className={styles.cardTitle}>Google ビジネス</h2>
            <span className={styles.rowSpacer} />
            {googleBadgeInfo ? <StatusBadge tone={googleBadgeInfo.tone} size="compact">{googleBadgeInfo.label}</StatusBadge> : null}
          </div>
          {googleError ? (
            <ListState kind="error" error={googleError} onRetry={() => void load()} />
          ) : !google ? (
            <ListState kind="loading" />
          ) : (
            <>
              <CustomerInfoRows
                rows={[
                  { label: '店舗', value: googleLocation ?? '—' },
                  { label: '最終同期', value: formatDate(google.connection.lastSyncedAt, { style: 'detail', fallback: '—' }) },
                  { label: '口コミ', value: google.summary.storedCount > 0 ? `${google.summary.storedCount}件・未返信 ${google.summary.unrepliedCount}件` : '—' },
                  { label: '投稿', value: google.summary.postsAttentionCount > 0 ? `要対応 ${google.summary.postsAttentionCount}件` : '—' },
                ]}
              />
              <div className={styles.links}>
                <Link className={styles.link} href="/restaurant-test/google?tab=reviews">口コミへ<ArrowRight size={14} aria-hidden /></Link>
                <Link className={styles.link} href="/restaurant-test/google?tab=posts">投稿へ<ArrowRight size={14} aria-hidden /></Link>
                <Link className={styles.link} href="/restaurant-test/google?tab=profile">プロフィールへ<ArrowRight size={14} aria-hidden /></Link>
                {/* Google の接続・解除は Google ビジネスの［設定］タブ 1 か所で行う（B-360 E）。 */}
                <Link className={styles.link} href="/restaurant-test/google?tab=settings">接続の設定へ<ArrowRight size={14} aria-hidden /></Link>
              </div>
            </>
          )}
        </Card>

        <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-labelledby="sns-instagram-title">
          <div className={styles.cardHead}>
            <span className={styles.mark} aria-hidden>IG</span>
            <h2 id="sns-instagram-title" className={styles.cardTitle}>Instagram</h2>
            <span className={styles.rowSpacer} />
            {igStatus ? <StatusBadge tone={igStatus.tone} size="compact">{igStatus.label}</StatusBadge> : null}
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
                <CustomerInfoRows
                  rows={[{
                    label: '接続しているアカウント',
                    value: igConnection.username ? `@${igConnection.username}（ビジネス）` : igConnection.pageName || emptyValue('unknown'),
                  }]}
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
                      <RefreshCw size={16} aria-hidden />
                      接続を確かめる
                    </Button>
                  ) : (
                    <>
                      <Button variant="primary" onClick={() => void connectInstagram()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">
                        <Link2 size={16} aria-hidden />
                        Instagram にログインして接続する
                      </Button>
                      <span className={styles.note}>Instagram のビジネスアカウント（またはクリエイターアカウント）でログインしてください。個人のアカウントは接続できません。</span>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </Card>

      </div>

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
