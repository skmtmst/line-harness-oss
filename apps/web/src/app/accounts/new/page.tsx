'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

export default function NewLineAccountPage() {
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [channelAccessToken, setChannelAccessToken] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [loginChannelId, setLoginChannelId] = useState('')
  const [loginChannelSecret, setLoginChannelSecret] = useState('')
  const [liffId, setLiffId] = useState('')

  return (
    <CreatePage
      title="LINEアカウントを追加する"
      description="LINE Developers で作ったチャネルを、この管理画面につなぎます。"
      parent={['LINEアカウント', '/accounts']}
      validate={() => {
        if (!name.trim()) return 'アカウント名を入力してください'
        if (!channelId.trim()) return 'Channel ID を入力してください'
        if (!channelAccessToken.trim()) return 'Channel Access Token を入力してください'
        if (!channelSecret.trim()) return 'Channel Secret を入力してください'
        // ログインチャネルは片方だけでは動かない。半端な状態で保存させない。
        if (Boolean(loginChannelId.trim()) !== Boolean(loginChannelSecret.trim())) {
          return 'LINEログインのIDとシークレットは、両方入れるか両方空にしてください'
        }
        return null
      }}
      onSave={async () => {
        const res = await api.lineAccounts.create({
          name: name.trim(),
          channelId: channelId.trim(),
          channelAccessToken: channelAccessToken.trim(),
          channelSecret: channelSecret.trim(),
          loginChannelId: loginChannelId.trim() || null,
          loginChannelSecret: loginChannelSecret.trim() || null,
          liffId: liffId.trim() || null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="アカウント名" htmlFor="ac-name" required note="この管理画面での呼び名です。">
        <input
          id="ac-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 渋谷店"
          className={inputClass}
        />
      </Field>

      <div className="border-hairline space-y-4 rounded-lg border p-4">
        <p className="text-ink-secondary text-sm font-semibold">
          Messaging API（メッセージの送受信に必要）
        </p>
        <Field label="Channel ID" htmlFor="ac-channel-id" required>
          <input
            id="ac-channel-id"
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label="Channel Access Token" htmlFor="ac-token" required>
          <input
            id="ac-token"
            type="password"
            value={channelAccessToken}
            onChange={(e) => setChannelAccessToken(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label="Channel Secret" htmlFor="ac-secret" required>
          <input
            id="ac-secret"
            type="password"
            value={channelSecret}
            onChange={(e) => setChannelSecret(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <div className="border-hairline space-y-4 rounded-lg border p-4">
        <p className="text-ink-secondary text-sm font-semibold">
          LINEログイン・LIFF（あとから入れても構いません）
        </p>
        <Field
          label="Login Channel ID"
          htmlFor="ac-login-id"
          note="流入経路の計測や、友だち追加時の識別に使います。"
        >
          <input
            id="ac-login-id"
            type="text"
            value={loginChannelId}
            onChange={(e) => setLoginChannelId(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label="Login Channel Secret" htmlFor="ac-login-secret">
          <input
            id="ac-login-secret"
            type="password"
            value={loginChannelSecret}
            onChange={(e) => setLoginChannelSecret(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field
          label="LIFF ID"
          htmlFor="ac-liff"
          note="予約フォームやウェビナーをLINE内で開くのに使います。"
        >
          <input
            id="ac-liff"
            type="text"
            value={liffId}
            onChange={(e) => setLiffId(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <p className="text-ink-faint text-xs leading-relaxed">
        鍵は保存後、画面に表示されません。設定し直すときは入力し直してください。
      </p>
    </CreatePage>
  )
}
