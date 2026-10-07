'use client'

/*
 * ★V8 Googleビジネス 設定（`CuHXG`：接続済み）。未接続・店舗の選択待ちも同じ場所で出す（今の画面と同じ口）。
 * 接続・再接続は Google の認可画面へ移る。解除・取り消し・切り替えは確認の小窓を経る。
 * 接続を管理できない人には、接続・解除のボタンを置かない。
 */
import { useState } from 'react'
import { Link2, RefreshCw } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge from '@/components/shared/status-badge'
import { restaurantGoogleApi, type GoogleConnectionData } from '@/lib/restaurant-google-api'
import { errorMessage, formatStampFull, formatYmd } from './format'
import styles from './google.module.css'

export default function SettingsBoard({ accountId, data, onChanged }: { accountId: string; data: GoogleConnectionData; onChanged: () => void }) {
  const canManage = data.permissions.canManageConnection
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState('')
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const { connection } = data
  // 店舗の選択待ちなのに前の店舗名が残っている＝別の店舗へ切り替えようとしている状態。
  const previousTitle = connection.status === 'pending_location' ? connection.locationTitle : null
  const switchingLocation = Boolean(connection.locationName) && selectedLocation !== '' && selectedLocation !== connection.locationName

  const startConnect = async () => {
    setBusy(true)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.connectStart(accountId)
      window.location.assign(response.authorizeUrl)
    } catch (err) {
      setActionError(errorMessage(err, 'Googleの認可画面を開けませんでした。'))
      setBusy(false)
    }
  }

  const selectLocation = async (confirmedSwitch = false) => {
    if (!selectedLocation) return
    setBusy(true)
    setActionError('')
    try {
      await restaurantGoogleApi.selectLocation(accountId, selectedLocation, confirmedSwitch)
      setConfirmSwitch(false)
      onChanged()
    } catch (err) {
      setActionError(errorMessage(err, '店舗を選べませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setActionError('')
    try {
      await restaurantGoogleApi.disconnect(accountId)
      setConfirmDisconnect(false)
      onChanged()
    } catch (err) {
      setActionError(errorMessage(err, '接続を解除できませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  const manageNote = !canManage ? <p className={styles.muted}>Googleアカウントの接続は、統括の管理者へ依頼してください。</p> : null

  if (connection.status === 'disconnected') {
    return (
      <section className={styles.card} aria-labelledby="google-connect-title">
        <h2 id="google-connect-title" className={styles.cardTitle}>Googleアカウントを接続 <StatusBadge tone="neutral">未接続</StatusBadge></h2>
        <p className={styles.preText}>{'店舗を管理しているGoogleアカウントでログインしてください。\n接続する店舗は、1つのLINEアカウントにつき1店舗です。'}</p>
        {!data.oauthConfigured ? <Notice tone="warn">この環境にはGoogle接続の設定がありません。運営に連絡してください。</Notice> : null}
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {canManage ? (
          <div className={styles.buttonRow}>
            <Button variant="primary" onClick={() => void startConnect()} disabled={busy || !data.oauthConfigured}><Link2 aria-hidden className={styles.icon15} />Googleアカウントを接続</Button>
          </div>
        ) : null}
        <p className={styles.grayNote}>初回接続時に、Googleで管理できる店舗から接続先を1店舗確認します。接続後は、このLINEアカウントの店舗だけを表示します。</p>
        {manageNote}
      </section>
    )
  }

  if (connection.status === 'pending_location') {
    return (
      <section className={styles.card} aria-labelledby="google-location-title">
        <h2 id="google-location-title" className={styles.cardTitle}>接続する店舗を選ぶ</h2>
        <p className={styles.muted}>{`Googleアカウントの認証は完了しています${connection.googleAccountEmail ? `（${connection.googleAccountEmail}）` : ''}`}</p>
        <p className={styles.preText}>{`このLINEアカウント（${data.store.name}）に接続する店舗を1つ選んでください。接続後は、選んだ店舗だけを表示します。`}</p>
        {previousTitle ? (
          <Notice tone="warn">{`いまは「${previousTitle}」につながっています。同じ店舗を選べばそのまま続けられます。別の店舗を選ぶと切り替わり、「${previousTitle}」で取り込んだ口コミ・下書き・プロフィール・投稿・数値は消えます（切り替える前に確認します）。`}</Notice>
        ) : null}
        <RadioCardGroup legend="接続するGoogleビジネスプロフィール" className={styles.radioList}>
          {data.candidates.map((candidate) => (
            <RadioCard
              key={candidate.locationName}
              name="location"
              value={candidate.locationName}
              checked={selectedLocation === candidate.locationName}
              onChange={() => setSelectedLocation(candidate.locationName)}
              title={candidate.locationTitle}
              note={candidate.addressText ?? undefined}
            />
          ))}
        </RadioCardGroup>
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {canManage ? (
          <div className={styles.buttonRowEnd}>
            <Button onClick={() => setConfirmDisconnect(true)} disabled={busy}>接続を取り消す</Button>
            <Button onClick={() => void startConnect()} disabled={busy}>別のGoogleアカウントでやり直す</Button>
            <Button variant="primary" onClick={() => (switchingLocation ? setConfirmSwitch(true) : void selectLocation())} disabled={busy || !selectedLocation}>
              {switchingLocation ? 'この店舗に切り替える' : 'この店舗を接続する'}
            </Button>
          </div>
        ) : manageNote}
        <ConfirmDialog open={confirmDisconnect} title="接続をやり直しますか？" description="いま進めている接続を取り消します。口コミの履歴は残ります。" confirmLabel="取り消す" destructive busy={busy} onConfirm={() => void disconnect()} onCancel={() => setConfirmDisconnect(false)} />
        <ConfirmDialog
          open={confirmSwitch}
          title="接続する店舗を切り替えますか？"
          description={`「${previousTitle ?? ''}」から切り替えます。これまでに取り込んだ口コミ・返信の下書き・プロフィール・投稿・数値は消え、戻せません。新しい店舗の分はこのあと取り込み直します。`}
          confirmLabel="切り替える"
          destructive
          busy={busy}
          onConfirm={() => void selectLocation(true)}
          onCancel={() => setConfirmSwitch(false)}
        />
      </section>
    )
  }

  const stateText = connection.status === 'connected'
    ? `接続中${data.writeEnabled ? '' : '（外部への更新は止めています・検証環境）'}`
    : connection.status === 'expired' ? '認可切れ（再接続してください）' : '権限なし（Google側の管理権限を確認してください）'

  return (
    <>
      {connection.status === 'expired' ? <Notice tone="danger">Googleとの接続を確認してください。認可が切れています。店舗を管理するGoogleアカウントで再接続してください。保存中の返信の下書きはいま残っていますが、Googleから取得した口コミは最終更新から30日以内に削除するため、再接続しないままだと下書きも一緒に消えます。</Notice> : null}
      {connection.status === 'no_permission' ? <Notice tone="danger">この店舗を操作する権限がありません。接続済み店舗の管理権限をGoogle側で確認してください。</Notice> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <section className={styles.card} aria-labelledby="google-account-title">
        <h2 id="google-account-title" className={styles.cardTitle}>Googleアカウント</h2>
        <dl className={styles.facts}>
          <div className={styles.factRow}><dt className={styles.factKey}>つないでいるアカウント</dt><dd className={styles.factValue}>{connection.googleAccountEmail ?? '—'}</dd></div>
          <div className={styles.factRow}><dt className={styles.factKey}>つないだ日</dt><dd className={styles.factValue}>{formatYmd(connection.connectedAt)}</dd></div>
          <div className={styles.factRow}><dt className={styles.factKey}>状態</dt><dd className={styles.factValue}>{stateText}</dd></div>
        </dl>
        {canManage ? (
          <div className={styles.buttonRowEnd}>
            <Button variant="danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>接続を解除</Button>
            <Button onClick={() => void startConnect()} disabled={busy}><RefreshCw aria-hidden className={styles.icon15} />Googleアカウントを再接続</Button>
          </div>
        ) : manageNote}
      </section>
      <p className={styles.grayNote}>接続を解除すると、口コミ・投稿・パフォーマンスの取り込みが止まります。解除の前に確認の小窓が出ます。</p>
      <p className={styles.footCaption}>{`LINEアカウント：${data.store.name}・接続店舗：${connection.locationTitle ?? '—'}・最終同期：${formatStampFull(connection.lastSyncedAt)}`}</p>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Googleアカウントの接続を解除しますか？"
        description="解除すると、Google側の許可を取り消し、保存しているトークンと、Googleから取得した口コミ・プロフィール・指標・取り込んだ投稿を削除します。返信の下書きも消えます。だれがいつ何をGoogleへ送ったかの記録だけ残ります。この操作は取り消せません。もう一度使うには再接続が必要です。"
        confirmLabel="接続を解除する"
        destructive
        busy={busy}
        error={actionError}
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </>
  )
}
