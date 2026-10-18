'use client'

import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import type { Dispatch,SetStateAction } from 'react'
import { AutoReplyDraft,AutoReplyOrderHint } from './edit-dialog-model'

type AutoReplyBasicFieldsContext = {
  draft: AutoReplyDraft
  folderId: string
  folders: { id: string; name: string; }[]
  foldersLoadState: "loading" | "ready" | "error"
  internalMemo: string
  orderHint: AutoReplyOrderHint | null
  page: boolean
  ruleName: string
  setFolderId: Dispatch<SetStateAction<string>>
  setFoldersReloadToken: Dispatch<SetStateAction<number>>
  setInternalMemo: Dispatch<SetStateAction<string>>
  setRuleName: Dispatch<SetStateAction<string>>
}

export function AutoReplyBasicFields({ draft, folderId, folders, foldersLoadState, internalMemo, orderHint, page, ruleName, setFolderId, setFoldersReloadToken, setInternalMemo, setRuleName }: AutoReplyBasicFieldsContext) {
  return (<section className="space-y-4">
            {!page && <div>
              <h2 className="text-ink text-lg font-bold">基本設定</h2>
              <p className="text-ink-faint mt-1 text-xs">ルール名・フォルダを決めます。動く順番は一覧で上下を入れ替えて決めます。</p>
            </div>}

            <div className={page ? 'grid items-start gap-3 xl:grid-cols-4' : ''}>
            <label className={page ? 'block xl:col-span-2' : 'mb-3 block'}>
              <span className="text-ink-secondary text-xs">自動応答名</span>
              <span className="text-ink-faint block text-micro">
                {page
                  ? '一覧に出る名前です。友だちには見えません。'
                  : '一覧に出る名前です。友だちには見えません。空にすると、キーワードが名前の代わりに出ます。'}
              </span>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                maxLength={250}
                placeholder="例：営業時間外の案内"
                className="border-hairline rounded-control focus:ring-accent mt-1 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </label>

            <div className={page ? '' : 'mb-3'}>
              <label htmlFor="auto-reply-folder" className="text-ink-secondary text-xs">
                フォルダ
              </label>
              <div className="mt-1 flex items-center gap-2">
                <Select
                  id="auto-reply-folder"
                  aria-label="フォルダ"
                  value={folderId}
                  onChange={setFolderId}
                  disabled={foldersLoadState !== 'ready'}
                  options={[
                    {
                      value: '',
                      label:
                        foldersLoadState === 'loading'
                          ? 'フォルダを読み込み中'
                          : foldersLoadState === 'error'
                            ? 'フォルダを読み込めませんでした'
                            : '未分類',
                    },
                    ...(folderId && !folders.some((folder) => folder.id === folderId)
                      ? [
                          {
                            value: folderId,
                            label:
                              foldersLoadState === 'ready'
                                ? '現在のフォルダ（一覧にありません）'
                                : '現在のフォルダ（名前を確認できません）',
                          },
                        ]
                      : []),
                    ...folders.map((f) => ({ value: f.id, label: f.name })),
                  ]}
                  size="full"
                />
                {foldersLoadState === 'error' && (
                  <Button onClick={() => setFoldersReloadToken((value) => value + 1)}>
                    再読み込み
                  </Button>
                )}
              </div>
              {foldersLoadState === 'error' && (
                <span className="text-danger mt-1 block text-xs">
                  フォルダを確認できないため、選択を変更できません。再読み込みしてください。
                </span>
              )}
            </div>
            <div className={page ? 'contents' : 'grid gap-3 md:grid-cols-2'}>
              {/*
                R28: 順番は数字で打たせず、一覧の並びで決める。ここでは
                実際の判定順（Worker と同じ・上から1つだけ動く）での位置と、
                先に当たるかもしれないルールだけ出す。
                m15c の共通 Select への1本化はフォルダ欄で活かす。
              */}
              <div className="block">
                <span className="text-ink-secondary text-xs">動く順番</span>
                <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
                  一覧の上から順に1つだけ動きます。
                  {orderHint?.position != null && orderHint?.total != null
                    ? `このルールは上から ${orderHint.position} 番目（全${orderHint.total}件中）です。`
                    : draft.id
                      ? '順番は一覧の「評価順」で入れ替えます。'
                      : '新しく作るルールは、一覧のいちばん下に足されます。'}
                </p>
                {orderHint && orderHint.earlier.length > 0 && (
                  <div className="mt-2">
                    <p className="text-ink-secondary text-xs">このルールより先に当たるかもしれないルール</p>
                    <ul className="text-ink-faint mt-1 list-disc space-y-0.5 pl-5 text-xs">
                      {orderHint.earlier.slice(0, 3).map((rule) => (
                        <li key={rule.id} className="truncate" title={rule.name}>
                          {rule.name}
                        </li>
                      ))}
                    </ul>
                    {orderHint.earlierTotal > 3 && (
                      <p className="text-ink-faint mt-0.5 text-xs">ほか {orderHint.earlierTotal - 3}件</p>
                    )}
                  </div>
                )}
              </div>
              <label className={page ? 'block xl:col-span-4' : 'block'}>
                <span className="text-ink-secondary text-xs">社内メモ <span className="text-ink-faint">任意</span></span>
                <textarea
                  rows={page ? 1 : 2}
                  value={internalMemo}
                  onChange={(event) => setInternalMemo(event.target.value)}
                  maxLength={1000}
                  placeholder="運用上の補足を入力"
                  className="border-hairline rounded-control mt-1 w-full border px-3 py-2 text-sm"
                />
                <span className="text-ink-faint mt-1 block text-xs">友だちには表示されません</span>
              </label>
            </div>
            </div>
          </section>)
}
