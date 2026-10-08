'use client'

/*
 * ★V8 予約枠・在庫「予約経路の連携」タブ（板 `hQQlt`）。
 *
 * 取り込みアドレス（メール転送）と今日の取り込み → 予約経路の表（媒体ごとの受け取り方・状態・
 * 今日の件数・最後に届いた時刻・読めなかった数）→ 読めなかったもの（手で直して取り込む）。
 * 口：/api/restaurant-test/intake-addresses・channels・inbound-emails（・/:id/manual-import）。
 * 検証環境は受信専用。媒体へは書き戻さない。
 */
import { useEffect, useState } from 'react'
import { BookOpen, Copy, FlaskConical } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import DateTimeField from '@/components/shared/date-time-field'
import { fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantIntakeAddress } from '@/lib/restaurant-test-api'
import { Status } from '../booking-kit/shell'
import { DialogField, DialogNote, RsDialog } from '../booking-kit/parts'
import { dayLabelParen, formatAt } from './format'
import styles from './inventory.module.css'

export type RestaurantChannel = {
  id: string
  code: string
  name: string
  todayCount: number | null
  lastReceivedAt: string | null
  unreadableCount: number | null
  receiveMethod: 'email_forward' | 'direct' | 'manual'
  status: 'receiving' | 'not_receiving' | 'preparing'
  daysWithoutReceipt: number | null
}

type InboundEmail = {
  id: string
  storeId: string
  receivedAt: string
  status: string
  reason: string | null
  mediaCode: string | null
  mediaName: string | null
}

const METHOD_LABEL: Record<RestaurantChannel['receiveMethod'], string> = {
  email_forward: 'メール転送（自動）',
  direct: '直接つなぐ（自動）',
  manual: '手で入れる',
}

const METHOD_SUB: Record<RestaurantChannel['receiveMethod'], string> = {
  email_forward: '予約通知メールを読む',
  direct: '直接の受け口',
  manual: '台帳へ直接入れる',
}

function channelStatus(channel: RestaurantChannel): { value: string; label: string } {
  if (channel.status === 'preparing') return { value: 'draft-neutral', label: '未設定' }
  if (channel.status === 'not_receiving') return { value: 'warning', label: `${channel.daysWithoutReceipt ?? 1}日届いていない` }
  if (channel.receiveMethod === 'direct') return { value: 'active', label: 'つながっている' }
  if (channel.receiveMethod === 'manual') return { value: 'active', label: '使っている' }
  return { value: 'active', label: '届いている' }
}

const accountQuery = (accountId: string, storeId: string) =>
  `account_id=${encodeURIComponent(accountId)}&storeId=${encodeURIComponent(storeId)}`

export default function ChannelsBoard({ accountId, storeId, date, canEdit }: {
  accountId: string
  storeId: string
  /** 店舗の今日（YYYY-MM-DD）。「今日の取り込み」の見出しに使う。 */
  date: string
  canEdit: boolean
}) {
  const [addresses, setAddresses] = useState<RestaurantIntakeAddress[] | null>(null)
  const [channels, setChannels] = useState<RestaurantChannel[] | null>(null)
  const [emails, setEmails] = useState<InboundEmail[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const [detail, setDetail] = useState<InboundEmail | null>(null)
  const [importing, setImporting] = useState<InboundEmail | null>(null)
  const [draft, setDraft] = useState({ customerName: '', guestCount: '2', startsAt: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    Promise.all([
      /* 取り込みアドレスと読めなかったメールは管理者だけの口。閲覧のみでは空として扱う。 */
      canEdit ? restaurantTestApi.listIntakeAddresses(accountId, storeId).then((res) => res.data) : Promise.resolve([]),
      fetchApi<{ success: true; data: RestaurantChannel[] }>(`/api/restaurant-test/channels?${accountQuery(accountId, storeId)}`).then((res) => res.data),
      canEdit
        ? fetchApi<{ success: true; data: InboundEmail[]; total: number }>(`/api/restaurant-test/inbound-emails?${accountQuery(accountId, storeId)}&status=quarantined`).then((res) => res)
        : Promise.resolve({ data: [] as InboundEmail[], total: 0 }),
    ]).then(([addr, chans, mails]) => {
      if (!alive) return
      setAddresses(Array.isArray(addr) ? addr : [])
      setChannels(Array.isArray(chans) ? chans : [])
      setEmails(Array.isArray(mails.data) ? mails.data : [])
      setTotal(mails.total ?? 0)
    }).catch(() => {
      if (alive) setFailed(true)
    })
    return () => { alive = false }
  }, [accountId, storeId, canEdit, reload])

  const address = addresses?.[0]?.address ?? null
  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const issue = () => {
    setBusy(true)
    void restaurantTestApi.issueIntakeAddress(accountId, storeId)
      .then(() => { setMessage({ tone: 'success', text: '取り込みアドレスを発行しました。' }); setReload((n) => n + 1) })
      .catch(() => setMessage({ tone: 'error', text: '取り込みアドレスを発行できませんでした。' }))
      .finally(() => setBusy(false))
  }

  const manualImport = () => {
    if (!importing || !draft.customerName.trim() || !draft.startsAt) return
    setBusy(true)
    const start = new Date(draft.startsAt)
    void fetchApi(`/api/restaurant-test/inbound-emails/${encodeURIComponent(importing.id)}/manual-import?account_id=${encodeURIComponent(accountId)}`, {
      method: 'POST',
      body: JSON.stringify({ customerName: draft.customerName.trim(), guestCount: Number(draft.guestCount), startsAt: start.toISOString() }),
    })
      .then(() => { setImporting(null); setMessage({ tone: 'success', text: '予約台帳へ取り込みました。卓は空いている卓から自動で選びました。' }); setReload((n) => n + 1) })
      .catch((error: unknown) => setMessage({ tone: 'error', text: error instanceof Error ? error.message : '取り込めませんでした。' }))
      .finally(() => setBusy(false))
  }

  if (failed) {
    return <ListState kind="error" description="予約経路を読み込めませんでした。" onRetry={() => setReload((n) => n + 1)} />
  }
  if (!addresses || !channels || !emails) return <ListState kind="loading" />

  const received = channels.filter((channel) => channel.receiveMethod !== 'manual').reduce((sum, channel) => sum + (channel.todayCount ?? 0), 0)

  return (
    <div data-design-node="hQQlt" className={styles.channels}>
      {message ? <p role="status" className={message.tone === 'success' ? styles.okBand : styles.errorBand}>{message.text}</p> : null}
      <div className={styles.channelCards}>
        <section className={styles.card} aria-labelledby="rs-intake-title">
          <h2 id="rs-intake-title" className={styles.sectionTitle}>取り込みアドレス（メール転送）</h2>
          <p className={styles.cardText}>予約媒体から店に届く「予約のお知らせメール」を、このアドレスへ転送すると自動で台帳に入ります。</p>
          <div className={styles.addressBox}>
            <span className={styles.addressText} title={address ?? undefined}>{address ?? (canEdit ? 'まだ発行されていません' : '管理者だけが見られます')}</span>
            {address ? (
              <Button onClick={() => void copy()}><Copy size={15} aria-hidden="true" />{copied ? '写しました' : 'コピー'}</Button>
            ) : canEdit ? (
              <Button variant="primary" disabled={busy} onClick={issue}>発行する</Button>
            ) : null}
          </div>
          <div className={styles.cardActions}>
            <Button onClick={() => setHowToOpen(true)}><BookOpen size={15} aria-hidden="true" />転送の設定のしかた</Button>
            <Button href="/restaurant-test/reservations"><FlaskConical size={15} aria-hidden="true" />試しに受け取る</Button>
          </div>
        </section>
        <section className={styles.card} aria-labelledby="rs-today-title">
          <h2 id="rs-today-title" className={styles.sectionTitle}>今日の取り込み</h2>
          <p className={styles.cardText}>{`${dayLabelParen(date)}0:00〜いま`}</p>
          <div className={styles.todayStats}>
            <div className={styles.todayStat}><p className={styles.todayValue}>{`${received}件`}</p><p className={styles.todayLabel}>取り込んだ</p></div>
            <div className={styles.todayStat}><p className={`${styles.todayValue} ${total > 0 ? styles.todayDanger : ''}`}>{`${total}件`}</p><p className={styles.todayLabel}>読めなかった</p></div>
          </div>
          {total > 0 ? (
            <p className={styles.warnNote}>{`読めなかった ${total} 件は、下の「読めなかったもの」から手で直して取り込めます。`}</p>
          ) : null}
        </section>
      </div>
      <DataTable className={styles.channelTable}>
        <thead>
          <TableHeadRow className={styles.channelHead}>
            <Th className={`${styles.cth} ${styles.chName}`}>予約経路</Th>
            <Th className={`${styles.cth} ${styles.chMethod}`}>受け取り方</Th>
            <Th className={`${styles.cth} ${styles.chStatus}`}>状態</Th>
            <Th className={`${styles.cth} ${styles.chToday}`} align="right">今日</Th>
            <Th className={`${styles.cth} ${styles.chLast}`}>最後に届いた</Th>
            <Th className={`${styles.cth} ${styles.chUnread}`} align="right">読めなかった</Th>
            <Th className={`${styles.cth} ${styles.chOps}`}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {channels.map((channel) => {
            const state = channelStatus(channel)
            const preparing = channel.status === 'preparing'
            return (
              <Tr key={channel.id} className={styles.channelRow}>
                <Td className={styles.ctd}>
                  <p className={styles.channelName} title={channel.name}>{channel.name}</p>
                  <p className={styles.channelSub}>{METHOD_SUB[channel.receiveMethod]}</p>
                </Td>
                <Td className={styles.ctd}>{preparing && channel.receiveMethod === 'email_forward' ? 'メール転送（未設定）' : METHOD_LABEL[channel.receiveMethod]}</Td>
                <Td className={styles.ctd}><Status value={state.value} label={state.label} /></Td>
                <Td className={styles.ctd} align="right">{preparing ? '—' : `${channel.todayCount ?? 0}件`}</Td>
                <Td className={styles.ctd}>{preparing ? '—' : formatAt(channel.lastReceivedAt)}</Td>
                <Td className={styles.ctd} align="right">{preparing || channel.receiveMethod === 'manual' ? '—' : channel.unreadableCount ?? 0}</Td>
                <Td className={styles.ctd}>
                  {channel.receiveMethod === 'manual' ? (
                    <Button href="/restaurant-test/reservations">台帳へ</Button>
                  ) : preparing ? (
                    <Button onClick={() => setHowToOpen(true)}>始める</Button>
                  ) : (
                    <Button href={`/restaurant-test/reservations?source=${encodeURIComponent(channel.code)}`} aria-label={`${channel.name}の記録`}>記録</Button>
                  )}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
      {canEdit ? (
        <section className={styles.card} aria-labelledby="rs-unread-title">
          <h2 id="rs-unread-title" className={styles.sectionTitle}>{`読めなかったもの ${total} 件`}</h2>
          <p className={styles.cardText}>形が変わったメールや、店の情報が合わないメールは、捨てずにここに残ります。</p>
          {emails.length === 0 ? (
            <p className={styles.cardText}>いま残っているものはありません。</p>
          ) : emails.map((mail) => (
            <div key={mail.id} className={styles.unreadRow}>
              <div className={styles.unreadMain}>
                <p className={styles.channelName}>{`${mail.mediaName ?? mail.mediaCode ?? '媒体不明'}の予約メール`}</p>
                <p className={styles.channelSub}>{`${formatAt(mail.receivedAt)} 受信・${mail.reason ?? '読めなかった理由は分かりません'}`}</p>
              </div>
              <Button onClick={() => setDetail(mail)}>詳しく見る</Button>
              <Button variant="primary" onClick={() => { setDraft({ customerName: '', guestCount: '2', startsAt: '' }); setImporting(mail) }}>手で直して取り込む</Button>
            </div>
          ))}
        </section>
      ) : null}
      <RsDialog
        open={howToOpen}
        title="転送の設定のしかた"
        width={560}
        top={180}
        onCancel={() => setHowToOpen(false)}
        actions={<Button variant="primary" onClick={() => setHowToOpen(false)}>わかった</Button>}
      >
        <ol className={styles.howTo}>
          <li>予約媒体の管理画面で、予約のお知らせメールの送り先を開きます。</li>
          <li>送り先に、上の取り込みアドレス{address ? `（${address}）` : ''}を足します。</li>
          <li>試しに予約を1件入れ、この画面の「今日の取り込み」に数が出るかを確かめます。</li>
        </ol>
        <DialogNote>検証環境は受信専用です。予約媒体へは書き戻しません。</DialogNote>
      </RsDialog>
      <RsDialog
        open={Boolean(detail)}
        title="読めなかったメール"
        width={520}
        top={200}
        onCancel={() => setDetail(null)}
        actions={<Button onClick={() => setDetail(null)}>閉じる</Button>}
      >
        {detail ? (
          <dl className={styles.detailList}>
            <dt>媒体</dt><dd>{detail.mediaName ?? detail.mediaCode ?? '媒体不明'}</dd>
            <dt>受信</dt><dd>{formatAt(detail.receivedAt)}</dd>
            <dt>読めなかった理由</dt><dd>{detail.reason ?? '分かりません'}</dd>
          </dl>
        ) : null}
        <DialogNote>メールの本文はこの画面には出しません。媒体の管理画面で予約の中身を確かめてから、手で直して取り込んでください。</DialogNote>
      </RsDialog>
      <RsDialog
        open={Boolean(importing)}
        title="手で直して取り込む"
        width={520}
        top={200}
        busy={busy}
        onCancel={() => setImporting(null)}
        onSubmit={manualImport}
        actions={(
          <>
            <Button type="button" onClick={() => setImporting(null)} disabled={busy}>キャンセル</Button>
            <Button type="submit" variant="primary" disabled={busy || !draft.customerName.trim() || !draft.startsAt}>台帳へ取り込む</Button>
          </>
        )}
      >
        <DialogField label="お客さまのお名前" htmlFor="rs-import-name">
          <TextField id="rs-import-name" required value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} />
        </DialogField>
        <div className={styles.pair}>
          <DialogField label="人数" htmlFor="rs-import-guests">
            <TextField id="rs-import-guests" type="number" min={1} max={100} required value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} />
          </DialogField>
          <DialogField label="来店の日時" htmlFor="rs-import-at">
            <DateTimeField id="rs-import-at" required value={draft.startsAt} onChange={(next) => setDraft({ ...draft, startsAt: next })} />
          </DialogField>
        </div>
        <DialogNote>取り込むと、空いている卓から自動で選んで予約台帳に入れます。</DialogNote>
      </RsDialog>
    </div>
  )
}
