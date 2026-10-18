'use client'

import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ImageUploader from '@/components/shared/image-uploader'
import Select from '@/components/shared/select'
import type { Dispatch,SetStateAction } from 'react'
import {
type InlineAction
} from './draft-fields'
import { AutoReplyDraft,LineImageContent,ResponseMode } from './edit-dialog-model'
import InlineActionList,{ useActionOptions } from './inline-action-list'

type AutoReplyResponseFieldsContext = {
  actionOptions: ReturnType<typeof useActionOptions>
  actions: InlineAction[]
  cooldown: string
  draft: AutoReplyDraft
  flexTemplates: { id: string; name: string; messageType: string; messageContent: string; }[]
  imageContent: LineImageContent | null
  imageTemplates: { id: string; name: string; messageType: string; messageContent: string; }[]
  isActive: boolean
  mode: ResponseMode
  page: boolean
  replyDelaySeconds: string
  responseContent: string
  setActions: Dispatch<SetStateAction<InlineAction[]>>
  setCooldown: Dispatch<SetStateAction<string>>
  setIsActive: Dispatch<SetStateAction<boolean>>
  setMode: Dispatch<SetStateAction<ResponseMode>>
  setReplyDelaySeconds: Dispatch<SetStateAction<string>>
  setResponseContent: Dispatch<SetStateAction<string>>
  setSkipWhenOperatorActive: Dispatch<SetStateAction<boolean>>
  setTemplateId: Dispatch<SetStateAction<string | null>>
  setUnmatchedMode: Dispatch<SetStateAction<"none" | "notify_operator">>
  skipWhenOperatorActive: boolean
  templateId: string | null
  templates: { id: string; name: string; messageType: string; messageContent: string; }[]
  textTemplates: { id: string; name: string; messageType: string; messageContent: string; }[]
  unmatchedMode: "none" | "notify_operator"
}

export function AutoReplyResponseFields({ actionOptions, actions, cooldown, draft, flexTemplates, imageContent, imageTemplates, isActive, mode, page, replyDelaySeconds, responseContent, setActions, setCooldown, setIsActive, setMode, setReplyDelaySeconds, setResponseContent, setSkipWhenOperatorActive, setTemplateId, setUnmatchedMode, skipWhenOperatorActive, templateId, templates, textTemplates, unmatchedMode }: AutoReplyResponseFieldsContext) {
  return (<section className="space-y-4">
          <div>
            <p className={page ? 'sr-only' : 'text-ink mb-2 text-sm font-semibold'}>3. 何を返すか</p>
            <label className="text-ink-secondary mb-1 block text-xs">返し方</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信しない' },
                { key: 'template', label: 'テンプレートから' },
                { key: 'inline-text', label: 'この画面に直接書く' },
                { key: 'inline-flex', label: 'カードを直接作る' },
                { key: 'inline-image', label: '画像を直接選ぶ' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  onClick={() => setMode(key)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${mode === key ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/*
           * 返し方ごとの編集部品は、ページ表示・ダイアログ表示で同じものを出す。
           * ページでは選択欄が !page の内側にあり、テンプレートも画像も
           * 選べないままだった（U001/U002）。
           */}
          {mode === 'template' && (
            <div className={page ? 'rounded-card border-hairline space-y-3 border bg-canvas-sunken p-3' : ''}>
              <label htmlFor="auto-reply-template" className="text-ink-secondary mb-1 block text-xs">テンプレート</label>
              {/*
                共通の選び欄は束見出しを持てないため、種類を名前の頭に付けて
                1列に並べる（カード／テキスト／画像の区別は残す）。
              */}
              <Select
                id="auto-reply-template"
                aria-label="テンプレート"
                value={templateId ?? ''}
                onChange={(value) => setTemplateId(value || null)}
                options={[
                  { value: '', label: '-- 選択 --' },
                  ...flexTemplates.map((t) => ({ value: t.id, label: `カード：${t.name}` })),
                  ...textTemplates.map((t) => ({ value: t.id, label: `テキスト：${t.name}` })),
                  ...imageTemplates.map((t) => ({ value: t.id, label: `画像：${t.name}` })),
                  ...templates.filter(t => t.messageType === 'imagemap').map(t => ({ value: t.id, label: `${(/"video"\s*:/.test(t.messageContent)) ? 'リッチビデオ' : 'リッチメッセージ'}：${t.name}` })),
                ]}
                size="full"
              />
              {templates.length === 0 && (
                <p className="text-warning mt-1 text-xs">
                  テンプレートがありません。<a href="/templates" className="underline">/templates</a> で作成してください。
                </p>
              )}
            </div>
          )}
          {(mode === 'inline-text' || mode === 'inline-flex') && (
            <div className={page ? 'rounded-card border-hairline space-y-3 border bg-canvas-sunken p-3' : ''}>
              {/*
                U058: 返信文の欄を先に出す。差し込みボタンの帯を上に置くと、
                狭い画面で入力欄が段の下まで押し出される。書く場所を先に
                見せて、差し込みはその下にまとめる。
              */}
              <label className="block">
                <span className={page ? 'text-ink text-sm font-semibold' : 'text-ink-secondary mb-1 block text-xs'}>
                  {mode === 'inline-flex' ? 'カードの内容（JSON）' : page ? '返信メッセージ' : 'テキスト'}
                </span>
                <textarea
                  rows={mode === 'inline-flex' ? 8 : page ? 5 : 4}
                  value={responseContent}
                  maxLength={5000}
                  onChange={(e) => setResponseContent(e.target.value)}
                  placeholder={mode === 'inline-flex' ? '{"type":"bubble", ...}' : '返信する内容を入力'}
                  className={page
                    ? 'border-hairline rounded-control mt-2 w-full resize-y border bg-canvas px-3 py-3 text-sm leading-relaxed'
                    : 'border-hairline rounded-control focus:ring-accent mt-1 w-full resize-y border px-3 py-2 font-mono text-xs focus:ring-2 focus:outline-none'}
                />
              </label>
              {page && mode === 'inline-text' && (
                <div className="flex flex-wrap gap-2" aria-label="差し込み項目">
                  {['名前', '友だち情報', '共通情報', '回答フォーム', '配信日', 'その他'].map((label) => (
                    <Button
                      key={label}
                      type="button"
                      onClick={() => setResponseContent((current) => `${current}{{${label}}}`)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              {mode === 'inline-flex' && (
                <p className="text-ink-faint text-xs leading-relaxed">
                  LINE のカード型メッセージ（Flex Message）の JSON を入力します。
                </p>
              )}
              {!page && mode === 'inline-text' && (
                <div className="mt-2 flex flex-wrap gap-2" aria-label="差し込み項目">
                  {['友だち名', '会社名', '担当者名', '予約日時'].map((label) => (
                    <Button
                      key={label}
                      type="button"
                      onClick={() => setResponseContent((current) => `${current}{{${label}}}`)}
                    >
                      ＋ {label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mode === 'inline-image' && (
            <ImageUploader
              mode="line-image"
              value={
                imageContent
                  ? { mode: 'line-image' as const, ...imageContent }
                  : null
              }
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
          {page && mode === 'silent' && (
            <p className="rounded-card border-hairline border bg-canvas-sunken p-3 text-ink-faint text-xs leading-relaxed">
              返信はしません。応答したときに実行する処理だけを下で設定します。
            </p>
          )}
          {/*
            R28: 評価順の数字入力は置かない（基本設定の「動く順番」に一本化）。
            順番を変えるときは一覧の「評価順」で上下を入れ替える。
          */}


          {/*
           * 応答したときに、あわせて行うこと。
           * ページ表示に置いていた見本の文章と処理の無い追加ボタンは、実設定と
           * 見分けが付かないので、ダイアログと同じ実編集部品へ結び付ける（U003）。
           */}
          <div className={page ? 'border-hairline rounded-card space-y-3 border p-4' : 'border-hairline space-y-3 rounded-control border p-3'}>
            <div>
              <p className="text-ink text-sm font-semibold">
                {page ? '配信後のアクション' : '4. 応答したときに行うこと'}
              </p>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                並べた順に実行します。タグを付けてから、そのタグを条件にした次の動きを置く、
                という書き方ができます。
              </p>
            </div>
            <InlineActionList
              actions={actions}
              onChange={setActions}
              {...actionOptions}
            />
          </div>

          {page && (
            <div className="border-hairline grid gap-3 rounded-card border p-4 md:grid-cols-2">
              <label className="block">
                <span className="text-ink-secondary text-xs">返信を待つ時間</span>
                <Select
                  aria-label="返信を待つ時間"
                  value={replyDelaySeconds}
                  onChange={setReplyDelaySeconds}
                  options={[
                    { value: '0', label: 'すぐに返信' },
                    { value: '10', label: '10秒後' },
                    { value: '30', label: '30秒後' },
                    { value: '60', label: '1分後' },
                    { value: '300', label: '5分後' },
                  ]}
                  size="full"
                />
              </label>
              <label className="block">
                <span className="text-ink-secondary text-xs">同じ人への連続返信</span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    value={cooldown}
                    onChange={(event) => setCooldown(event.target.value)}
                    className="border-hairline rounded-control w-24 border px-3 py-2 text-sm"
                    placeholder="なし"
                  />
                  <span className="text-ink-faint text-xs">分あける</span>
                </span>
              </label>
              <div className="md:col-span-2">
                <p className="text-ink-secondary text-xs">条件に当たらなかった場合</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant={unmatchedMode === 'notify_operator' ? 'primary' : undefined} onClick={() => setUnmatchedMode('notify_operator')}>
                    担当者へ引き継ぐ
                  </Button>
                  <Button type="button" variant={unmatchedMode === 'none' ? 'primary' : undefined} onClick={() => setUnmatchedMode('none')}>
                    何もしない
                  </Button>
                </div>
              </div>
              <div className="md:col-span-2">
                <Checkbox
                  checked={skipWhenOperatorActive}
                  onCheckedChange={setSkipWhenOperatorActive}
                  description="「対応中」のときだけ止まり、対応中が解除されるとあらためて動きます。未対応のまま放置されているトークには返します。予約・支払いなどの自動通知は別の送信経路なので止まりません。"
                >
                  担当者が対応中のトークでは返さない
                </Checkbox>
              </div>
            </div>
          )}

          {draft.id ? (
            <Checkbox
              checked={isActive}
              onCheckedChange={setIsActive}
            >
              この応答をオンにする
            </Checkbox>
          ) : (
            // AUTOREPLY-08: 新しい応答は止まった状態で保存される。
            // 有効化は一覧の「再開」や公開前の確認から、別の操作で行う。
            <p className="text-ink-faint text-xs">
              新しく作る応答は、止まった状態で保存されます。動かすには、保存したあと一覧の「再開」から有効にします。
            </p>
          )}
          </section>)
}
