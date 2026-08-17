'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import ImageUploader from '@/components/shared/image-uploader'

export interface AutoReplyDraft {
  id?: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  /** JST の "HH:MM"。null で時間帯を問わない */
  activeFrom?: string | null
  activeUntil?: string | null
  /** この分数は同じ相手へ自動応答を返さない。null で抑制しない */
  cooldownMinutes?: number | null
  /** 担当者が対応中のトークでは返さない */
  skipWhenOperatorActive?: boolean
  /** 評価順。小さいほど先に見る */
  priority?: number
  /** 対象にするメッセージ種別。null / 空で全部 */
  messageKinds?: string[] | null
}

/** 画面に出すメッセージ種別。LINE から届くもののうち、実務で使うものだけ。 */
const MESSAGE_KIND_LABELS: Array<{ key: string; label: string }> = [
  { key: 'text', label: 'テキスト' },
  { key: 'image', label: '画像' },
  { key: 'video', label: '動画' },
  { key: 'audio', label: '音声' },
  { key: 'file', label: 'ファイル' },
  { key: 'location', label: '位置情報' },
  { key: 'sticker', label: 'スタンプ' },
  { key: 'postback', label: 'ボタンのタップ' },
]

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

export default function EditDialog({ draft, templates, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  const [activeFrom, setActiveFrom] = useState(draft.activeFrom ?? '')
  const [activeUntil, setActiveUntil] = useState(draft.activeUntil ?? '')
  const [cooldown, setCooldown] = useState(
    draft.cooldownMinutes == null ? '' : String(draft.cooldownMinutes),
  )
  const [skipWhenOperatorActive, setSkipWhenOperatorActive] = useState(
    draft.skipWhenOperatorActive ?? false,
  )
  const [priority, setPriority] = useState(String(draft.priority ?? 0))
  const [messageKinds, setMessageKinds] = useState<string[]>(draft.messageKinds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const flexTemplates = templates.filter((t) => t.messageType === 'flex')
  const textTemplates = templates.filter((t) => t.messageType === 'text')
  const imageTemplates = templates.filter((t) => t.messageType === 'image')

  const handleSave = async () => {
    if (!keyword.trim()) { setError('keyword を入力してください'); return }
    if (mode === 'template' && !templateId) { setError('template を選んでください'); return }
    if ((mode === 'inline-text' || mode === 'inline-flex' || mode === 'inline-image') && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    setError('')
    setSaving(true)
    try {
      const body: {
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        activeFrom: string | null;
        activeUntil: string | null;
        cooldownMinutes: number | null;
        skipWhenOperatorActive: boolean;
        priority: number;
        messageKinds: string[] | null;
      } = {
        keyword,
        matchType,
        responseType:
          mode === 'silent' ? 'silent'
          : mode === 'inline-flex' ? 'flex'
          : mode === 'inline-image' ? 'image'
          : mode === 'template' ? 'text' /* placeholder, override below if template found */
          : 'text',
        // template mode でも response_content / response_type を残す。template が
        // 削除された (ON DELETE SET NULL) ときの inline fallback として機能する。
        responseContent: mode === 'silent' ? '' : responseContent,
        templateId: mode === 'template' ? templateId : null,
        lineAccountId: draft.lineAccountId,
        isActive,
        activeFrom: activeFrom || null,
        activeUntil: activeUntil || null,
        cooldownMinutes: cooldown.trim() === '' ? null : Number(cooldown),
        skipWhenOperatorActive,
        priority: Number(priority) || 0,
        // 全部選ぶことと、1つも選ばないことは同じ意味。null に寄せる。
        messageKinds:
          messageKinds.length === 0 || messageKinds.length === MESSAGE_KIND_LABELS.length
            ? null
            : messageKinds,
      }
      if (mode === 'template' && templateId) {
        const tpl = templates.find((t) => t.id === templateId)
        if (tpl) {
          body.responseType = tpl.messageType
          // template が削除された (ON DELETE SET NULL) ときの inline fallback として
          // 現時点の template content をスナップショット保存する。これがないと
          // template 削除後に webhook が空メッセージ送信になる。
          body.responseContent = tpl.messageContent
        }
      }
      if (draft.id) {
        await api.autoReplies.update(draft.id, body)
      } else {
        await api.autoReplies.create(body)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b">
          <h3 className="text-base font-semibold">{draft.id ? '自動応答編集' : '自動応答を作る'}</h3>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            受け取ったメッセージに自動で返します。曜日や時間帯、友だちの条件で出し分けできます。
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-ink mb-2 text-sm font-semibold">1. どのメッセージに反応するか</p>
            <label className="text-ink-secondary mb-1 block text-xs">キーワード</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: コスト比較"
            />
          </div>
          <div>
            <label className="text-ink-secondary mb-1 block text-xs">一致のしかた</label>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((mt) => (
                <button
                  key={mt}
                  onClick={() => setMatchType(mt)}
                  className={`rounded-control px-3 py-1.5 text-xs ${matchType === mt ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {mt === 'exact' ? '完全一致' : '部分一致'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-ink mb-2 text-sm font-semibold">3. 何を返すか</p>
            <label className="text-ink-secondary mb-1 block text-xs">返し方</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信しない' },
                { key: 'template', label: 'テンプレートから' },
                { key: 'inline-text', label: 'この画面に直接書く' },
                { key: 'inline-flex', label: 'Flex（JSONを直接書く）' },
                { key: 'inline-image', label: '画像（JSONを直接書く）' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`rounded-control px-3 py-1.5 text-xs ${mode === key ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'template' && (
            <div>
              <label className="text-ink-secondary mb-1 block text-xs">テンプレート</label>
              <select
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">-- 選択 --</option>
                {flexTemplates.length > 0 && (
                  <optgroup label="Flex">
                    {flexTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {textTemplates.length > 0 && (
                  <optgroup label="テキスト">
                    {textTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {imageTemplates.length > 0 && (
                  <optgroup label="画像">
                    {imageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {templates.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  テンプレートがありません。<a href="/templates" className="underline">/templates</a> で作成してください。
                </p>
              )}
            </div>
          )}
          {(mode === 'inline-text' || mode === 'inline-flex') && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                {mode === 'inline-flex' ? 'Flex JSON' : 'テキスト'}
              </label>
              <textarea
                rows={mode === 'inline-flex' ? 8 : 4}
                value={responseContent}
                onChange={(e) => setResponseContent(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              />
            </div>
          )}
          {mode === 'inline-image' && (
            <ImageUploader
              mode="line-image"
              value={(() => {
                try {
                  const parsed = JSON.parse(responseContent) as { originalContentUrl?: string; previewImageUrl?: string }
                  if (parsed.originalContentUrl) {
                    return {
                      mode: 'line-image' as const,
                      originalContentUrl: parsed.originalContentUrl,
                      previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                    }
                  }
                } catch { /* ignore */ }
                return null
              })()}
              onChange={(v) => {
                if (v?.mode === 'line-image') {
                  setResponseContent(JSON.stringify({
                    originalContentUrl: v.originalContentUrl,
                    previewImageUrl: v.previewImageUrl,
                  }))
                } else {
                  setResponseContent('')
                }
              }}
              label="返信画像"
            />
          )}
          <div>
            <label htmlFor="ar-priority" className="text-ink-faint mb-1 block text-xs">
              評価順
            </label>
            <input
              id="ar-priority"
              type="number"
              min={-9999}
              max={9999}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
            />
            <p className="text-ink-faint mt-1 text-[11px] leading-relaxed">
              小さいほど先に見ます。上から順に見て、最初に当てはまった1つだけが動きます。
              間に挿し込めるよう、10・20・30 のように間を空けておくと後で楽です。
            </p>
          </div>

          {/* 返す条件。キーワードが合っても、ここに当てはまらなければ返さない。 */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <p className="text-ink text-sm font-semibold">2. いつ・誰に反応するか</p>
            {/* 曜日ごとの指定を持っていない。時間帯だけ。 */}
            <p className="text-ink-faint text-xs">
              曜日ごとの指定は準備中です。いまは毎日、決めた時間帯で反応します。
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ar-from" className="text-ink-faint mb-1 block text-xs">
                  時間帯（JST）
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="ar-from"
                    type="time"
                    value={activeFrom}
                    onChange={(e) => setActiveFrom(e.target.value)}
                    className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                  />
                  <span className="text-ink-faint text-xs">〜</span>
                  <input
                    aria-label="時間帯の終わり"
                    type="time"
                    value={activeUntil}
                    onChange={(e) => setActiveUntil(e.target.value)}
                    className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ar-cooldown" className="text-ink-faint mb-1 block text-xs">
                  連投を防ぐ
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="ar-cooldown"
                    type="number"
                    min={0}
                    max={10080}
                    step={1}
                    placeholder="なし"
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
                  />
                  <span className="text-ink-faint text-xs">分</span>
                </div>
              </div>
            </div>
            <p className="text-ink-faint text-[11px] leading-relaxed">
              時間帯を空にすると、いつでも返します。22:00〜06:00 のように日をまたぐ指定もできます
              （開始を含み、終了は含みません）。<br />
              「連投を防ぐ」は、その相手へ自動応答を返してからこの分数のあいだ、どのルールでも返さない設定です。
            </p>
            <div>
              <p className="text-ink-faint mb-1.5 text-xs">対象にするメッセージ</p>
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_KIND_LABELS.map(({ key, label }) => {
                  const on = messageKinds.length === 0 || messageKinds.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setMessageKinds((prev) => {
                          // 何も選んでいない状態は「全部」を意味する。そこから
                          // 1つ外すには、いったん全部を入れてから外す。
                          const base = prev.length === 0 ? MESSAGE_KIND_LABELS.map((m) => m.key) : prev
                          return base.includes(key)
                            ? base.filter((k) => k !== key)
                            : [...base, key]
                        })
                      }
                      className={`rounded-pill px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'bg-accent text-on-accent'
                          : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="text-ink-faint mt-1 text-[11px]">
                すべて選んだ状態と、1つも選ばない状態は同じ意味です（種別で絞りません）。
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={skipWhenOperatorActive}
                onChange={(e) => setSkipWhenOperatorActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-ink-secondary text-xs">
                担当者が対応中のトークでは返さない
                <span className="text-ink-faint block text-[11px]">
                  「対応中」のときだけ止まります。未対応のまま放置されているトークには返します。
                </span>
              </span>
            </label>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-ink-secondary text-xs">この応答をオンにする</span>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md">キャンセル</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
