'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type OpsNoticeLineAccount } from '@/lib/api'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'
import { formatNumber } from '@/lib/format'
import { TextField } from '@/components/shared/text-field'
import { isStepUpRequired, useStepUpGate } from '@/components/step-up-prompt'

/**
 * 契約者専用LINEに使うアカウントの指定（決定 2026-09-18 案A）。
 * 運営会社（既定の統括）に登録した公式アカウントから選ぶ。★管理画面 37-10「運営の情報」。
 */
export default function NoticeLineAccountCard() {
  const [data, setData] = useState<OpsNoticeLineAccount | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [channelId, setChannelId] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [basicId, setBasicId] = useState('')
  const { gate, prompt } = useStepUpGate()

  const load = useCallback(async () => {
    const res = await opsCall(api.ops.noticeLineAccount())
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setData(res.data)
    setSelected(res.data.currentId ?? '')
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.setNoticeLineAccount(selected || null))
    setBusy(false)
    if (!res.success) { setError(res.error || '保存できませんでした。時間をおいて、もう一度お試しください。'); return }
    setNotice(selected ? '契約者専用LINEのアカウントを指定しました' : '指定を外しました')
    await load()
  }

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const input = { channelId: channelId.trim(), channelSecret: channelSecret.trim(), basicId: basicId.trim() }
    try {
      let result
      try {
        result = await api.ops.connectNoticeLineAccount(input)
      } catch (failure) {
        if (!isStepUpRequired(failure)) throw failure
        const token = await gate('line_account.connect', '契約者専用LINEを接続する')
        if (!token) return
        result = await api.ops.connectNoticeLineAccount(input, token)
      }
      if (!result.success) { setError(result.error || '接続できませんでした'); return }
      setChannelSecret('')
      setNotice(`${result.data.name}（${result.data.basicId}）を契約者専用LINEに指定しました`)
      await load()
    } catch (failure) {
      setError(japaneseDetailOf(failure) || 'LINEに接続できませんでした。時間をおいて再試行してください')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="契約者専用LINE" className="grid gap-3 rounded-card border content-card bg-canvas px-5 py-4">
      <div>
        <h3 className="text-label font-semibold text-ink">契約者専用LINE</h3>
        <p className="text-micro text-ink-secondary">契約先の権限者へ大事なお知らせを送る通知専用の公式アカウントです。問い合わせは各アカウントの管理画面から受け付けます。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SaveErrorField names={["selected"]}><EntitySelect
          aria-label="契約者専用LINEに使うアカウント"
          className="w-80"
          value={selected}
          onChange={(value) => setSelected(value)}
          options={[{ value: '', label: '（指定しない）' }, ...(data?.candidates ?? []).map((c) => ({ ...entityOptionMetadata(c), value: c.id, label: c.basicId ? `${c.name}（${c.basicId}）` : c.name }))]}
        /></SaveErrorField>
        <Button variant="primary" onClick={() => void save()} disabled={busy || !data || selected === (data.currentId ?? '')}>保存する</Button>
      </div>
      {data?.current ? (
        <p className="text-caption text-ink">
          いまの指定：<span className="font-bold">{data.current.name}</span>
          {data.current.addFriendUrl ? <>　友だち追加：<a href={data.current.addFriendUrl} target="_blank" rel="noreferrer" className="text-action underline-offset-2 hover:underline">{data.current.addFriendUrl}</a></> : '　（LINE の基本ID が未取得のため、友だち追加の URL はまだ出せません）'}
          　登録済み {data.linked.linked}人 / {formatNumber(data.linked.total)}人
        </p>
      ) : (
        <p className="text-caption text-ink-secondary">未指定です。指定するまで、お知らせは画面とメールだけで送れます。</p>
      )}
      {data && !data.current ? (
        <div className="grid gap-3 border-t border-hairline pt-4">
          <div>
            <h4 className="text-label font-semibold text-ink">通知専用LINEを接続</h4>
            <p className="text-micro text-ink-secondary">LINE公式アカウントのMessaging APIを接続します。LINEログインとLIFFは不要です。Webhookの利用をONにしてから接続してください。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-caption text-ink">LINEの@ID
              <TextField value={basicId} onChange={(event) => setBasicId(event.target.value)} placeholder="@から始まるID" autoComplete="off" required />
            </label>
            <label className="grid gap-1 text-caption text-ink">Messaging APIのチャネルID
              <TextField value={channelId} onChange={(event) => setChannelId(event.target.value)} inputMode="numeric" autoComplete="off" required />
            </label>
            <label className="grid gap-1 text-caption text-ink">チャネルシークレット
              <TextField type="password" value={channelSecret} onChange={(event) => setChannelSecret(event.target.value)} autoComplete="off" required />
            </label>
          </div>
          <div><Button variant="primary" onClick={() => void connect()} busy={busy} disabled={!basicId.trim() || !channelId.trim() || !channelSecret.trim()}>接続して指定する</Button></div>
        </div>
      ) : null}
      {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null}
      {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      {prompt}
    </section>
  )
}
