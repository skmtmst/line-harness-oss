'use client'

import { useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'
import AutomationDraftEditor from '@/components/automations/automation-draft-editor'
import ListState from '@/components/shared/list-state'

const EVENTS = [
  { value: 'message_received', label: 'メッセージを受け取ったとき' },
  { value: 'friend_added', label: '友だちになったとき' },
  { value: 'tag_added', label: 'タグが付いたとき' },
  { value: 'form_submitted', label: 'フォームに答えたとき' },
  { value: 'link_clicked', label: 'リンクを踏んだとき' },
] as const

const ACTIONS = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'send_message', label: 'メッセージを送る' },
] as const

export default function NewAutomationPage() {
  const [draftId, setDraftId] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<string>(EVENTS[0].value)
  const [keyword, setKeyword] = useState('')
  const [actionType, setActionType] = useState<string>(ACTIONS[0].value)
  const [actionTagId, setActionTagId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
  }, [])

  useEffect(() => {
    setDraftId(new URLSearchParams(window.location.search).get('draftId'))
  }, [])

  if (draftId === undefined) {
    return <ListState kind="loading" title="下書きを読み込んでいます" />
  }
  if (draftId) return <AutomationDraftEditor draftId={draftId} />

  return (
    <CreatePage
      title="ルールを作る"
      description="「こうなったら、こうする」を決めておくと、あとは自動で動きます。"
      parent={['オートメーション', '/automations']}
      validate={() => {
        if (!name.trim()) return 'ルール名を入力してください'
        if (actionType === 'add_tag' && !actionTagId) return '付けるタグを選んでください'
        if (actionType === 'send_message' && !actionMessage.trim()) {
          return '送る文面を入力してください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setKeyword('')
        setActionMessage('')
      }}
      onSave={async () => {
        const res = await api.automations.create({
          name: name.trim(),
          eventType: eventType as Parameters<typeof api.automations.create>[0]['eventType'],
          conditions: keyword.trim() ? { keyword: keyword.trim() } : {},
          // すること（アクション）は { type, params } の形で持つ。
          // params の中身は type ごとに違う。
          actions: [
            actionType === 'add_tag'
              ? { type: 'add_tag' as const, params: { tagId: actionTagId } }
              : {
                  type: 'send_message' as const,
                  params: { messageType: 'text', messageContent: actionMessage.trim() },
                },
          ],
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <p className="text-ink text-sm font-semibold">1. どのルールか</p>
      <p className="text-ink-faint text-xs">一覧に表示される名前です。</p>

      <Field label="ルール名" htmlFor="au-name" required>
        <input
          id="au-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 「予約」と送られたらタグを付ける"
          className={inputClass}
        />
      </Field>

      <p className="text-ink mt-2 text-sm font-semibold">2. 何が起きたら動かすか</p>
      <p className="text-ink-faint text-xs">ここで選んだ出来事が起きた人だけが対象になります。</p>

      <Field label="きっかけ" htmlFor="au-event" required>
        <select
          id="au-event"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className={inputClass}
        >
          {EVENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </Field>

      {eventType === 'message_received' && (
        <Field
          label="含まれる言葉"
          htmlFor="au-keyword"
          note="空欄なら、どんなメッセージでも動きます。"
        >
          <input
            id="au-keyword"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例: 予約"
            className={inputClass}
          />
        </Field>
      )}

      <p className="text-ink mt-2 text-sm font-semibold">3. 何をするか</p>

      <Field label="すること" htmlFor="au-action" required>
        <select
          id="au-action"
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className={inputClass}
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      {actionType === 'add_tag' ? (
        <Field label="付けるタグ" htmlFor="au-tag" required>
          <select
            id="au-tag"
            value={actionTagId}
            onChange={(e) => setActionTagId(e.target.value)}
            className={inputClass}
          >
            <option value="">— 選んでください —</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field
          label="送る文面"
          htmlFor="au-message"
          required
          note="差し込みが使えます（例: {{name}}さん）。"
        >
          <textarea
            id="au-message"
            rows={4}
            value={actionMessage}
            onChange={(e) => setActionMessage(e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </Field>
      )}

      <p className="text-ink-faint text-xs leading-relaxed">
        作ったあと、一覧から条件やすることを足せます。ここでは1つだけ決めて始められるようにしています。
      </p>
    </CreatePage>
  )
}
