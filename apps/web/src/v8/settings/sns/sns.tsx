'use client'

/**
 * ★V8-B 設定 › SNS 連携（`YINmJ` 未接続 ／ `DFnll` Instagram 接続済み、2026-10-07 利用者承認）。
 *
 * Googleビジネスと Instagram を1列のカードで縦に並べる。
 * Instagram は「Instagram にログインして接続」だけで繋がる（ページを選ぶ段は無い）。
 * 繋ぐ目的は Googleビジネスの投稿を Instagram へ同時に出すこと。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
/* lucide には Instagram の印が無いので、写真の印（Camera）を使う。 */
import { Camera, RefreshCw, Settings } from 'lucide-react'
import type { InstagramConnectionStatus } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { usePageTitle, usePageCrumbs, useHideSettingsNav } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { restaurantGoogleApi, type GoogleConnectionData } from '@/lib/restaurant-google-api'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import styles from './sns.module.css'

const GOOGLE_STATE: Record<string, string> = {
  connected: '接続しています',
  pending_location: '店舗を選んでいません',
  expired: '認可が切れています',
  no_permission: '権限がありません',
  disconnected: '未接続',
}

const INSTAGRAM_STATE: Record<InstagramConnectionStatus['state'], string> = {
  connected: '接続しています',
  disconnected: '未接続',
  expired: '認可が切れています',
  unconfigured: '設定がありません',
}

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
  usePageTitle('SNS 連携')
  usePageCrumbs([{ label: '設定', href: '/settings' }])
  useHideSettingsNav()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)

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
    } catch {
      setBusy(false)
      setActionError('Instagram のログイン画面を開けませんでした。もう一度お試しください。')
    }
  }

  const checkInstagram = async () => {
    if (!selectedAccountId) return
    setBusy(true)
    setActionError('')
    try {
      await api.instagram.refresh(selectedAccountId)
      await load()
    } catch {
      setActionError('接続を確かめられませんでした。もう一度お試しください。')
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
    } catch {
      setActionError(confirm === 'google'
        ? 'Googleビジネスの接続を解除できませんでした。もう一度お試しください。'
        : 'Instagram の接続を解除できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageFrame kind="list" boardId="y3GGTs">
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
            <h2 id="sns-google-title" className={styles.cardTitle}>Googleビジネス プロフィール</h2>
            <p className={styles.cardSub}>お店の情報と投稿を、Google 検索とマップに出します</p>
          </div>
          {googleError ? (
            <ListState kind="error" error={googleError} onRetry={() => void load()} />
          ) : !google ? (
            <ListState kind="loading" />
          ) : (
            <>
              <Row label="いまの状態" value={GOOGLE_STATE[google.connection.status] ?? '—'} />
              <Row label="接続しているビジネス" value={google.connection.locationTitle ?? '—'} />
              <div className={styles.actions}>
                <Button variant="secondary" href="/restaurant-test/google?tab=settings">
                  <Settings size={15} />
                  Googleビジネスの設定を開く
                </Button>
                {googleConnected && canManage ? (
                  <>
                    <span className={styles.rowSpacer} />
                    <Button variant="text" onClick={() => { setActionError(''); setConfirm('google') }}>
                      接続を解除する
                    </Button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </section>

        <section className={styles.card} aria-labelledby="sns-instagram-title">
          <div className={styles.cardHead}>
            <h2 id="sns-instagram-title" className={styles.cardTitle}>Instagram</h2>
            <p className={styles.cardSub}>Googleビジネスの投稿を、Instagram にも同時に出せます</p>
          </div>
          {instagramError ? (
            <ListState kind="error" error={instagramError} onRetry={() => void load()} />
          ) : !igState ? (
            <ListState kind="loading" />
          ) : (
            <>
              <Row label="いまの状態" value={INSTAGRAM_STATE[igState]} />
              {igState === 'connected' && igConnection ? (
                <>
                  <Row
                    label="接続しているアカウント"
                    value={igConnection.username ? `@${igConnection.username}（ビジネス）` : igConnection.pageName || '—'}
                  />
                  <Row label="できること" value="写真つき投稿の同時公開" />
                </>
              ) : null}
              {igState === 'unconfigured' ? (
                <p className={styles.note}>この環境には Instagram 接続の設定がありません。</p>
              ) : igState === 'connected' ? null : (
                <p className={styles.note}>
                  Instagram のビジネスアカウント（またはクリエイターアカウント）でログインしてください。個人のアカウントは接続できません。
                </p>
              )}
              {canManage && igState !== 'unconfigured' ? (
                <div className={styles.actions}>
                  {igState === 'connected' ? (
                    <Button variant="secondary" onClick={() => void checkInstagram()} disabled={busy}>
                      <RefreshCw size={15} />
                      接続を確かめる
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={() => void connectInstagram()} disabled={busy}>
                      <Camera size={15} aria-hidden />
                      Instagram にログインして接続
                    </Button>
                  )}
                  {igState === 'connected' || igState === 'expired' ? (
                    <>
                      <span className={styles.rowSpacer} />
                      <Button variant="text" onClick={() => { setActionError(''); setConfirm('instagram') }}>
                        接続を解除する
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm === 'google'}
        destructive
        title="Googleビジネスの接続を解除しますか？"
        description="解除すると、口コミの取り込みと投稿の公開が止まります。あとでもう一度つなぎ直せます。"
        confirmLabel="解除する"
        busy={busy}
        onConfirm={() => void runDisconnect()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'instagram'}
        destructive
        title="Instagram の接続を解除しますか？"
        description="解除すると、Googleビジネスの投稿を Instagram へ同時に出せなくなります。あとでもう一度つなぎ直せます。"
        confirmLabel="解除する"
        busy={busy}
        onConfirm={() => void runDisconnect()}
        onCancel={() => setConfirm(null)}
      />
    </PageFrame>
  )
}
