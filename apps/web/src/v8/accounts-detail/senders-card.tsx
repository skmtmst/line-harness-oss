'use client'

/*
 * 送り手（板 Asa6v・G8）：メッセージの送り主として、お客さまの LINE に出る名前と顔。
 * 一覧（アイコン・名前・使える人）と［送り手を追加］。口は lineSenderApi（Codex・GAP1）。
 * 名前は 20 文字まで・「LINE」「ライン」は使えない（サーバーが拒否し、理由をそのまま出す）。
 * 閲覧のみには追加・使わないを出さない。スタッフは自分用だけ、オーナー・管理者は全員用も作れる。
 */
import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { LineSender } from '@line-crm/shared'
import { lineSenderApi } from '@/lib/api-gap1'
import { ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import { RowMenu } from '@/components/shared/row-actions'
import styles from './senders-card.module.css'

const NAME_MAX = 20

export default function SendersCard({ accountId, accountName }: { accountId: string; accountName: string }) {
  const role = useStaffRole()
  const canManage = canManageRole(role)
  const canAdd = role !== 'viewer' && role !== null
  const [senders, setSenders] = useState<LineSender[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'owner_only'>('owner_only')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState<LineSender | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await lineSenderApi.list(accountId)
      setSenders(res.success ? res.data.filter((row) => row.status === 'active') : [])
    } catch {
      setFailed(true)
    }
  }, [accountId])
  useEffect(() => { setSenders(null); void load() }, [load])

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > NAME_MAX || busy) return
    setBusy(true)
    setError('')
    try {
      await lineSenderApi.create(accountId, { name: trimmed, visibility: canManage ? visibility : 'owner_only' }, idempotencyKey)
      setAdding(false)
      setName('')
      setIdempotencyKey(crypto.randomUUID())
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError && caught.message ? caught.message : '追加できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!stopping || busy) return
    setBusy(true)
    try {
      await lineSenderApi.deactivate(accountId, stopping.id, stopping.version)
      setStopping(null)
      await load()
    } catch {
      setError('使わない設定にできませんでした。読み直してもう一度お試しください。')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="form" aria-labelledby="acd-senders">
      <CardHeader size="stacked" headingLevel={3} titleId="acd-senders" title="送り手"
        meta="メッセージの送り主として、名前とアイコンを切り替えられます（LINE の決まり：名前は 20 文字まで・公式アカウントの名前と並んで出ます）"
        action={canAdd ? <Button onClick={() => { setError(''); setAdding(true) }}><Plus size={15} aria-hidden="true" />送り手を追加</Button> : undefined} />
      {failed ? (
        <ListState kind="error" title="送り手を読み込めませんでした" onRetry={() => void load()} />
      ) : senders === null ? (
        <ListState kind="loading" title="送り手を読み込んでいます" />
      ) : (
        <ul className={styles.list}>
          <li className={styles.row}>
            <span className={styles.icon} aria-hidden="true">{accountName.slice(0, 1)}</span>
            <span className={styles.name}>店の名前（いつもの）</span>
            <span className={styles.who}>全員</span>
          </li>
          {senders.map((sender) => (
            <li key={sender.id} className={styles.row}>
              {sender.iconUrl
                // eslint-disable-next-line @next/next/no-img-element -- 送り手のアイコン（同じ店の登録メディア）
                ? <img src={sender.iconUrl} alt="" className={styles.icon} />
                : <span className={styles.icon} aria-hidden="true">{sender.name.slice(0, 1)}</span>}
              <span className={styles.name} title={sender.name}>{sender.name}{sender.iconMissing ? '（画像が見つかりません）' : ''}</span>
              <span className={styles.who}>{sender.visibility === 'all' ? '全員' : '本人だけ'}</span>
              {canManage || sender.visibility === 'owner_only' ? (
                <RowMenu label={`送り手「${sender.name}」の操作`} items={[{ id: 'stop', label: '使わない', tone: 'danger', onSelect: () => setStopping(sender) }]} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={adding}
        title="送り手を追加"
        description="お客さまの LINE で、メッセージの上に出る名前と顔です"
        confirmLabel="追加する"
        busy={busy}
        error={error || undefined}
        confirmDisabled={!name.trim() || name.trim().length > NAME_MAX}
        onConfirm={() => create()}
        onCancel={() => { if (!busy) setAdding(false) }}
      >
        <Field label="名前" htmlFor="sender-name" note={`${name.trim().length} / ${NAME_MAX} 文字`}>
          <TextField id="sender-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX + 10} placeholder="例：店長 Kenta" />
        </Field>
        {canManage ? (
          <Field label="使える人">
            <Select aria-label="使える人" size="full" value={visibility} onChange={(value) => setVisibility(value as 'all' | 'owner_only')}
              options={[{ value: 'all', label: '全員' }, { value: 'owner_only', label: '自分だけ' }]} />
          </Field>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={stopping !== null}
        title={`「${stopping?.name ?? ''}」を使わなくしますか？`}
        description="これから送るメッセージでは選べなくなります。すでに送った分の名前・アイコンはそのまま残ります。"
        confirmLabel="使わない"
        destructive
        busy={busy}
        onConfirm={() => stop()}
        onCancel={() => { if (!busy) setStopping(null) }}
      />
    </Card>
  )
}
