'use client'

/*
 * ★V8 LINEアカウントの詳細（Pencil `ihjfd`）。
 *
 * 白い板の頭（題・状態の1行・右に「編集する」「乗り換え」）→ 左に「設定の中のメニュー」→
 * 中央に登録の内容・つづき・資格情報・Webhook、右にできること・気をつけること・つながる先・
 * 送受信を止める／アーカイブ。窓（止める CFAyf・資格情報 Msb1j・アーカイブ WOfBN・
 * 編集 n9Z2P）は dialogs.tsx。データの口は今の画面（app/accounts/detail）と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArchiveRestore, ArrowLeftRight, Eye, Pause, Pencil, Play, QrCode } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import {
  ArchiveDialog,
  CredentialsDialog,
  EditDialog,
  RestoreDialog,
  StopDialog,
  TestRecipientsDialog,
  type CredentialKind,
} from './dialogs'
import {
  archiveBlockedReason,
  credentialLine,
  friendsLine,
  shortDateTime,
  skippedKindLabel,
  stateBadge,
  summaryLine,
  webhookMatch,
  webhookUse,
  type AccountDetailView,
} from './view'
import styles from './detail.module.css'

type Skipped = Array<{ id: string; kind: string; title: string | null; skippedAt: string }>

const CAN_DO = ['・友だち追加URLとQRはここに出ます', '・人ごとの既定のアカウントはここで決めます', '・接続の異常や停止は、ここで見張ります'].join('\n')
const CAREFUL = ['・停止しても、友だちと履歴は消えません', '・アーカイブした記録はあとから戻せます', '・資格情報を差し替えたら、接続の表示を確かめます'].join('\n')
const LINKS = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/friends', label: '友だち' },
  { href: '/staff', label: 'ログインユーザー' },
  { href: '/emergency', label: '運用状態' },
] as const

export default function AccountDetailV8() {
  const search = useSearchParams()
  const id = search?.get('id') ?? ''
  const role = useStaffRole()
  // 変える操作はオーナー・管理者だけ。役割が分かるまでは出さない（今の画面と同じ）。
  const canManage = role !== null && canManageRole(role)
  const viewer = role !== null && !canManage

  const [account, setAccount] = useState<AccountDetailView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [missing, setMissing] = useState(false)
  // 親の名前用の一覧は補助。取れなくても詳細は出し、その欄だけ取り直せる（R521）。
  const [all, setAll] = useState<LineAccount[]>([])
  const [allState, setAllState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [recipients, setRecipients] = useState<string[] | null | 'error'>(null)
  const [skipped, setSkipped] = useState<Skipped | null | 'error'>(null)

  const [stopTarget, setStopTarget] = useState<LineAccount | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<LineAccount | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<LineAccount | null>(null)
  const [editing, setEditing] = useState(false)
  const [credentials, setCredentials] = useState<CredentialKind | null>(null)
  const [recipientsOpen, setRecipientsOpen] = useState(false)

  const loadAll = useCallback(async () => {
    setAllState('loading')
    try {
      const list = await api.lineAccounts.list()
      if (!list.success) { setAllState('error'); return }
      setAll(list.data)
      setAllState('ready')
    } catch {
      setAllState('error')
    }
  }, [])

  const loadRecipients = useCallback(async () => {
    if (!id) return
    try {
      const res = await api.accountSettings.getTestRecipients(id)
      setRecipients(res.success && Array.isArray(res.data) ? res.data.map((r) => r.displayName) : 'error')
    } catch {
      setRecipients('error')
    }
  }, [id])

  const load = useCallback(async () => {
    if (!id) return
    setMissing(false)
    try {
      const one = await api.lineAccounts.get(id)
      if (!one.success) { setStatus('error'); return }
      const data = one.data as AccountDetailView
      setAccount(data)
      // 止まっているアカウントでは「送らなかった」一覧も読む（X-1）。
      if (!data.isActive && !data.archivedAt) {
        api.lineAccounts.skippedDeliveries(id)
          .then((res) => { setSkipped(res.success && Array.isArray(res.data) ? res.data : 'error') })
          .catch(() => { setSkipped('error') /* 一覧が読めなくても詳細は使える。 */ })
      } else {
        setSkipped(null)
      }
      setStatus('ready')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
        setStatus('ready')
        return
      }
      setStatus('error')
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadAll() }, [loadAll])
  useEffect(() => { void loadRecipients() }, [loadRecipients])
  usePageTitle(account?.name ?? 'LINEアカウント')
  usePageCrumbs([{ label: '設定' }, { label: 'LINEアカウント', href: '/accounts' }])

  /*
   * `?tab=`（今の画面のタブ：overview・connection・credentials・handover）は読まない。V8 は1枚の画面で、
   * 資格情報・Webhook も最初の画面に出ている。動かすと窓の撮影の位置がずれる（BEHAVIOR.md）。
   */

  const frame = (children: ReactNode, title = 'LINEアカウント') => (
    <div className={styles.screen}>
      <SettingsPage boardId="ihjfd" title={title} navigation={<SettingsInnerNav inline />}>{children}</SettingsPage>
    </div>
  )

  if (!id) {
    return frame(
      <TargetMissing
        kind="unspecified"
        title="見るアカウントが指定されていません"
        description="LINEアカウントの一覧から、見るアカウントを選び直してください。"
        backHref="/accounts"
        backLabel="LINEアカウントの一覧へ戻る"
      />,
    )
  }
  if (status === 'loading') return frame(<ListState kind="loading" />)
  if (missing || (status === 'ready' && !account)) {
    return frame(
      <TargetMissing
        kind="not-found"
        title="このアカウントは見つかりません"
        description="削除されたか、別の記録です。一覧から選び直してください。"
        backHref="/accounts"
        backLabel="LINEアカウントの一覧へ戻る"
      />,
    )
  }
  if (status === 'error' || !account) {
    return frame(
      <TargetMissing
        kind="error"
        title="アカウントを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />,
    )
  }

  const parent = account.parentLineAccountId ? all.find((a) => a.id === account.parentLineAccountId) ?? null : null
  const state = stateBadge(account)
  const use = webhookUse(account)
  const match = webhookMatch(account)
  const blocked = archiveBlockedReason(account)
  const lastReceived = account.connection?.lastReceivedAt ?? account.lastWebhookReceivedAt ?? null

  const parentValue = !account.parentLineAccountId
    ? 'なし'
    : allState === 'ready'
      ? parent?.name ?? '—'
      : allState === 'loading'
        ? '読み込んでいます'
        : null

  const recipientValue = recipients === null
    ? '読み込んでいます'
    : recipients === 'error'
      ? '読み込めませんでした'
      : recipients.length === 0 ? '未設定' : recipients.join('、')

  const headActions = (
    <div className={styles.headActions}>
      {canManage ? (
        <Button type="button" onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" />編集する
        </Button>
      ) : null}
      <Button href={`/accounts/handover?id=${account.id}`}>
        <ArrowLeftRight size={14} aria-hidden="true" />乗り換え
      </Button>
    </div>
  )

  return (
    <div className={styles.screen}>
      <SettingsPage
        boardId="ihjfd"
        title={account.name}
        description={summaryLine(account, parent?.name ?? null)}
        actions={headActions}
        navigation={<SettingsInnerNav inline />}
      >
        {viewer ? (
          <p className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。</span>
          </p>
        ) : null}
        <div className={styles.columns}>
          <div className={styles.main}>
            <section className={styles.card} aria-labelledby="acd-basic">
              <div className={styles.cardHead}><h3 id="acd-basic" className={styles.cardTitle}>登録の内容</h3></div>
              <Row label="表示名">{account.name}</Row>
              <Row label="チャネルID">{account.channelId}</Row>
              <Row label="親アカウント">
                {parentValue ?? (
                  <span className={styles.inline}>
                    読み込めませんでした
                    <button type="button" className={styles.textButton} onClick={() => void loadAll()}>もう一度読み込む</button>
                  </span>
                )}
              </Row>
              <Row label="タイムゾーン">{account.timezone ?? 'Asia/Tokyo'}</Row>
              <Row label="テスト送信先">
                <span className={styles.inline}>
                  <span className={styles.truncate} title={recipientValue}>{recipientValue}</span>
                  {canManage ? (
                    <button type="button" className={styles.textButton} onClick={() => setRecipientsOpen(true)}>変える</button>
                  ) : null}
                </span>
              </Row>
            </section>

            <section className={styles.card} aria-labelledby="acd-credentials">
              <div className={styles.inner}>
                <h3 className={styles.cardTitle}>登録の内容（つづき）</h3>
                <Pair label="友だち数">{friendsLine(account)}</Pair>
                <Pair label="状態"><span className={styles.end}><StatusBadge tone={state.tone}>{state.label}</StatusBadge></span></Pair>
                <Pair label="国・地域">{account.country ?? '未設定'}</Pair>
                <Pair label="役割メモ">{account.role ?? '未設定'}</Pair>
              </div>
              <div className={styles.cardHead} id="acd-credentials-head">
                <h3 id="acd-credentials" className={styles.cardTitle}>資格情報</h3>
                <p className={styles.cardSub}>秘密値そのものは表示しません。差し替えるときは、新しい値を入れて保存し直します。</p>
              </div>
              <Row label="チャネルシークレット">
                <ActionValue
                  value={credentialLine({ configured: account.channelSecretConfigured, last4: account.channelSecretLast4, updatedAt: null, checkedAt: account.connection?.lastTestAt ?? null })}
                  action={canManage ? <Button type="button" onClick={() => setCredentials('messaging')}>差し替える</Button> : null}
                />
              </Row>
              <Row label="Loginチャネルシークレット">
                <ActionValue
                  value={credentialLine({ configured: account.loginChannelSecretConfigured, last4: account.loginChannelSecretLast4, updatedAt: account.loginChannelSecretUpdatedAt })}
                  action={canManage ? <Button type="button" onClick={() => setCredentials('login')}>差し替える</Button> : null}
                />
              </Row>
              <div className={styles.wide}>
                <span className={styles.wideLabel}>チャネルアクセストークン</span>
                <span className={styles.wideValue}>
                  {credentialLine({ configured: account.channelAccessTokenConfigured, last4: account.channelAccessTokenLast4, updatedAt: account.channelAccessTokenUpdatedAt })}
                </span>
                {canManage ? <Button type="button" onClick={() => setCredentials('messaging')}>差し替える</Button> : null}
              </div>
              <Row label="Webhookの利用" id="acd-webhook">
                <span className={styles.inline}>
                  <StatusBadge tone={use.tone}>{use.label}</StatusBadge>
                  {lastReceived ? <span className={styles.faint}>最後の受信 {shortDateTime(lastReceived)}</span> : null}
                </span>
              </Row>
              <Row label="このシステムが待っているURL">
                <span className={styles.truncate} title={account.webhook?.expectedUrl ?? undefined}>{account.webhook?.expectedUrl ?? '—'}</span>
              </Row>
              <Row label="LINE側に登録したURL">
                <span className={styles.inline}>
                  <span className={styles.muted} title={match.value}>{match.value}</span>
                  <StatusBadge tone={match.tone}>{match.badge}</StatusBadge>
                </span>
              </Row>
            </section>

            {!account.isActive && !account.archivedAt ? (
              <section className={styles.card} aria-labelledby="acd-skipped">
                <div className={styles.cardHead}>
                  <h3 id="acd-skipped" className={styles.cardTitle}>止まっている間に送らなかったもの</h3>
                  {account.inactivatedAt ? (
                    <p className={styles.cardSub}>
                      {formatDateTime(account.inactivatedAt)} から止まっています{account.inactiveReasonDetail ? `（理由: ${account.inactiveReasonDetail}）` : ''}
                    </p>
                  ) : null}
                </div>
                {skipped === null ? (
                  <p className={styles.muted}>読み込んでいます…</p>
                ) : skipped === 'error' ? (
                  <p className={styles.muted}>送らなかった配信の一覧を読み込めませんでした。詳細のほかの欄はそのまま使えます。</p>
                ) : skipped.length === 0 ? (
                  <p className={styles.muted}>送らなかった配信はありません。</p>
                ) : (
                  <ul className={styles.skippedList}>
                    {skipped.map((row) => (
                      <li key={row.id} className={styles.skippedRow}>
                        <span className={styles.truncate} title={row.title ?? row.kind}>{row.title ?? skippedKindLabel(row.kind)}</span>
                        <span className={styles.faint}>{skippedKindLabel(row.kind)}・{formatDateTime(row.skippedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={styles.faint}>再開しても、ここに並んだ配信は自動では送り直しません。</p>
              </section>
            ) : null}
          </div>

          <aside className={styles.side}>
            <section className={styles.card} aria-labelledby="acd-cando">
              <div className={styles.cardHead}><h3 id="acd-cando" className={styles.cardTitle}>このアカウントでできること</h3></div>
              <p className={styles.bullets}>{CAN_DO}</p>
              <Button href="/?qr=base" className={styles.fit}><QrCode size={14} aria-hidden="true" />友だち追加URLとQRを見る</Button>
            </section>
            <section className={styles.card} aria-labelledby="acd-careful">
              <div className={styles.cardHead}><h3 id="acd-careful" className={styles.cardTitle}>気をつけること</h3></div>
              <p className={styles.bullets}>{CAREFUL}</p>
            </section>
            <section className={styles.card} aria-labelledby="acd-links">
              <div className={styles.cardHead}><h3 id="acd-links" className={styles.cardTitle}>つながる先</h3></div>
              <p className={styles.links}>
                {LINKS.map((link, index) => (
                  <span key={link.href}>{index > 0 ? '　' : ''}<Link href={link.href}>→ {link.label}</Link></span>
                ))}
              </p>
            </section>
            {canManage ? (
              <div className={styles.actions}>
                {account.archivedAt ? (
                  <Button type="button" onClick={() => setRestoreTarget(account)}>
                    <ArchiveRestore size={14} aria-hidden="true" />アーカイブから戻す
                  </Button>
                ) : (
                  <>
                    <Button type="button" onClick={() => setStopTarget(account)}>
                      {account.isActive ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      {account.isActive ? '送受信を止める' : '送受信を再開する'}
                    </Button>
                    <Button type="button" variant="danger" disabled={blocked !== null} onClick={() => setArchiveTarget(account)}>
                      アーカイブする
                    </Button>
                    {blocked ? <p className={styles.note}>{blocked}</p> : null}
                  </>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      </SettingsPage>

      <StopDialog account={stopTarget} onClose={() => setStopTarget(null)} onDone={load} />
      <ArchiveDialog account={archiveTarget} onClose={() => setArchiveTarget(null)} onDone={load} />
      <RestoreDialog account={restoreTarget} onClose={() => setRestoreTarget(null)} onDone={load} />
      <EditDialog account={editing ? account : null} canEditTimezone={role === 'owner'} onClose={() => setEditing(false)} onSaved={() => void load()} />
      <CredentialsDialog account={credentials ? account : null} kind={credentials ?? 'messaging'} onClose={() => setCredentials(null)} onSaved={() => void load()} />
      <TestRecipientsDialog accountId={account.id} open={recipientsOpen} onClose={() => { setRecipientsOpen(false); void loadRecipients() }} />
    </div>
  )
}

/** 札（幅150）と値の1行。上に線。 */
function Row({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className={styles.row} id={id}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  )
}

/** つづきの段の1行。札と値を半分ずつ。下に線。 */
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.pair}>
      <span className={styles.pairLabel}>{label}</span>
      <span className={styles.pairValue}>{children}</span>
    </div>
  )
}

/** 値と、右端の操作。 */
function ActionValue({ value, action }: { value: string; action: ReactNode }) {
  return (
    <span className={styles.actionValue}>
      <span className={styles.muted} title={value}>{value}</span>
      <span className={styles.spacer} />
      {action}
    </span>
  )
}
