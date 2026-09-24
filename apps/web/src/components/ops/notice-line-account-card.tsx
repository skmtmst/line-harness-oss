'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type OpsNoticeLineAccount } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'

/**
 * 契約者専用LINEに使うアカウントの指定（決定 2026-09-18 案A）。
 * 運営会社（既定の統括）に登録した公式アカウントから選ぶ。★V6 37-10「運営の情報」。
 */
export default function NoticeLineAccountCard() {
  const [data, setData] = useState<OpsNoticeLineAccount | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    if (!res.success) { setError(res.error || '保存できませんでした'); return }
    setNotice(selected ? '契約者専用LINEのアカウントを指定しました' : '指定を外しました')
    await load()
  }

  return (
    <section aria-label="契約者専用LINE" className="grid gap-3 rounded-card border border-hairline bg-canvas px-5 py-4">
      <div>
        <h3 className="text-label font-bold text-ink">契約者専用LINE</h3>
        <p className="text-micro text-ink-secondary">契約先の権限者へ大事なお知らせを送る公式アカウントです。運営会社のアカウントとして登録したものから選びます。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          aria-label="契約者専用LINEに使うアカウント"
          className="w-80"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={[{ value: '', label: '（指定しない）' }, ...(data?.candidates ?? []).map((c) => ({ value: c.id, label: c.basicId ? `${c.name}（${c.basicId}）` : c.name }))]}
        />
        <Button variant="primary" onClick={() => void save()} disabled={busy || !data || selected === (data.currentId ?? '')}>保存する</Button>
      </div>
      {data?.current ? (
        <p className="text-caption text-ink">
          いまの指定：<span className="font-bold">{data.current.name}</span>
          {data.current.addFriendUrl ? <>　友だち追加：<a href={data.current.addFriendUrl} target="_blank" rel="noreferrer" className="text-action underline-offset-2 hover:underline">{data.current.addFriendUrl}</a></> : '　（LINE の基本ID が未取得のため、友だち追加の URL はまだ出せません）'}
          　登録済み {data.linked.linked}人 / {data.linked.total}人
        </p>
      ) : (
        <p className="text-caption text-ink-secondary">未指定です。指定するまで、お知らせは画面とメールだけで送れます。</p>
      )}
      {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null}
      {error ? <p role="alert" className="text-caption text-status-danger">{error}</p> : null}
    </section>
  )
}
