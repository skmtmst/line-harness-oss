'use client'

import { MESSAGE_KIND_WORDS, messageKindWord } from '@/v8/auto-replies/public/auto-reply-words/index'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConditionBuilder from '@/components/shared/condition-builder'
import { TimeField } from '@/components/shared/date-time-field'
import Notice from '@/components/shared/notice'
import RadioCard,{ RadioCardGroup } from '@/components/shared/radio-card'
import { formatNumber } from '@/lib/format'
import { type SegmentCondition } from '@/lib/segment-condition'
import type { Dispatch,SetStateAction } from 'react'
import {
emptyKeywordRule,
exactAllMismatchNotice,
HOLIDAY_RULE_LABELS,
WEEKDAY_LABELS,
type HolidayRuleValue,
type KeywordRuleDraft
} from './draft-fields'
import { AutoReplyDraft } from './edit-dialog-model'

type AutoReplyTriggerFieldsContext = {
  activeFrom: string
  activeUntil: string
  changeMatchType: (next: "exact" | "contains") => void
  cooldown: string
  draft: AutoReplyDraft
  friendConditionOpen: boolean
  friendConditions: SegmentCondition | null
  holidayRule: HolidayRuleValue
  keywordMatchMode: "any" | "all"
  keywordRules: KeywordRuleDraft[]
  matchType: "exact" | "contains"
  messageKinds: string[]
  oncePerFriend: boolean
  page: boolean
  receiveSources: ("email" | "line")[]
  respondToAll: boolean
  setActiveFrom: Dispatch<SetStateAction<string>>
  setActiveUntil: Dispatch<SetStateAction<string>>
  setCooldown: Dispatch<SetStateAction<string>>
  setFriendConditionOpen: Dispatch<SetStateAction<boolean>>
  setFriendConditions: Dispatch<SetStateAction<SegmentCondition | null>>
  setHolidayRule: Dispatch<SetStateAction<HolidayRuleValue>>
  setKeyword: Dispatch<SetStateAction<string>>
  setKeywordMatchMode: Dispatch<SetStateAction<"any" | "all">>
  setKeywordRules: Dispatch<SetStateAction<KeywordRuleDraft[]>>
  setMessageKinds: Dispatch<SetStateAction<string[]>>
  setOncePerFriend: Dispatch<SetStateAction<boolean>>
  setReceiveSources: Dispatch<SetStateAction<("email" | "line")[]>>
  setRespondToAll: Dispatch<SetStateAction<boolean>>
  setSkipWhenOperatorActive: Dispatch<SetStateAction<boolean>>
  setWeekdayNotice: Dispatch<SetStateAction<string | null>>
  setWeekdays: Dispatch<SetStateAction<number[]>>
  skipWhenOperatorActive: boolean
  weekdayNotice: string | null
  weekdays: number[]
}

export function AutoReplyTriggerFields({ activeFrom, activeUntil, changeMatchType, cooldown, draft, friendConditionOpen, friendConditions, holidayRule, keywordMatchMode, keywordRules, matchType, messageKinds, oncePerFriend, page, receiveSources, respondToAll, setActiveFrom, setActiveUntil, setCooldown, setFriendConditionOpen, setFriendConditions, setHolidayRule, setKeyword, setKeywordMatchMode, setKeywordRules, setMessageKinds, setOncePerFriend, setReceiveSources, setRespondToAll, setSkipWhenOperatorActive, setWeekdayNotice, setWeekdays, skipWhenOperatorActive, weekdayNotice, weekdays }: AutoReplyTriggerFieldsContext) {
  return (<section className="space-y-4">
            {!page && <div>
              <h2 className="text-ink text-lg font-bold">1. どのメッセージに反応するか</h2>
              <p className="text-ink-faint mt-1 text-xs">受信した言葉・曜日・時間帯・相手で絞ります。</p>
            </div>}
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                aria-pressed={!respondToAll}
                onClick={() => setRespondToAll(false)}
                className={`rounded-control border px-3 py-1.5 text-xs ${!respondToAll ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
              >
                キーワードで応答
              </button>
              <button
                type="button"
                aria-pressed={respondToAll}
                onClick={() => setRespondToAll(true)}
                className={`rounded-control border px-3 py-1.5 text-xs ${respondToAll ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
              >
                一律で応答
              </button>
            </div>

            {respondToAll ? (
              <p className="text-ink-faint text-xs leading-relaxed">
                届いたメッセージすべてに応答します。「営業時間外はこれを返す」のような使い方を
                想定しています。曜日・時間帯・友だちの条件は、このあとで見ます。
                <span className="mt-1 block">
                  評価順が同じときは、キーワードのあるルールを先に見ます。一律のルールが
                  先に当たって、ほかが動かなくなることはありません。
                </span>
              </p>
            ) : (
              <div className="space-y-2">
                <label className="text-ink-secondary block text-xs">受信メッセージに含む言葉</label>
                {keywordRules.map((rule, index) => (
                  <div key={`keyword-${index}`} className="flex items-center gap-2">
                    {index > 0 && (
                      <span className="text-ink-faint w-10 shrink-0 text-center text-xs font-medium">
                        {keywordMatchMode === 'all' ? 'かつ' : 'または'}
                      </span>
                    )}
                    <input
                      type="text"
                      value={rule.keyword}
                      maxLength={200}
                      aria-label={`キーワード${index + 1}`}
                      onChange={(event) => {
                        const next = keywordRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, keyword: event.target.value } : item,
                        )
                        setKeywordRules(next)
                        if (index === 0) setKeyword(event.target.value)
                      }}
                      className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                      placeholder={index === 0 ? '例：予約変更' : 'キーワードを追加'}
                    />
                    {keywordRules.length > 1 && (
                      <Button
                        type="button"
                        aria-label={`キーワード${index + 1}を削除`}
                        onClick={() => {
                          const next = keywordRules.filter((_, itemIndex) => itemIndex !== index)
                          setKeywordRules(next)
                          setKeyword(next[0]?.keyword ?? '')
                        }}
                      >
                        削除する
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() => setKeywordRules((current) => [...current, emptyKeywordRule(matchType)])}
                >
                  ＋ キーワードを追加する
                </Button>
              </div>
            )}
          <div className={respondToAll ? 'hidden' : ''}>
            <label className="text-ink-secondary mb-1 block text-xs">
              キーワードが複数あるとき
            </label>
            <div className="mb-3 flex gap-2">
              {(
                [
                  { value: 'any' as const, label: 'どれか1つに当たれば返す' },
                  { value: 'all' as const, label: 'すべて当たったときだけ返す' },
                ]
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={keywordMatchMode === o.value}
                  onClick={() => setKeywordMatchMode(o.value)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${keywordMatchMode === o.value ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-ink-faint mb-3 text-micro leading-relaxed">
              「すべて」は絞り込みに使います。「予約」と「キャンセル」の両方が入った文にだけ
              返す、という形です。片方だけの問い合わせには返しません。
            </p>
            {/*
              R257: 異なる文言の完全一致をすべて必須にすると不成立になる。
              条件を勝手に変えず、理由だけを知らせて保存は止めない。
            */}
            {exactAllMismatchNotice(keywordRules, keywordMatchMode) ? (
              <Notice tone="warn" className="mb-3">
                {exactAllMismatchNotice(keywordRules, keywordMatchMode)}
              </Notice>
            ) : null}

            <label className="text-ink-secondary mb-1 block text-xs">一致のしかた</label>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((mt) => (
                <button
                  key={mt}
                  type="button"
                  aria-pressed={matchType === mt}
                  onClick={() => changeMatchType(mt)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${matchType === mt ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {mt === 'exact' ? '完全一致' : '部分一致'}
                </button>
              ))}
            </div>
          </div>
          {/* 返す条件。キーワードが合っても、ここに当てはまらなければ返さない。 */}
          <div className="border-hairline space-y-3 rounded-control border p-3">
            <p className="text-ink text-sm font-semibold">2. いつ・誰に反応するか</p>
            <p className="text-ink-faint text-xs">
              複数のキーワードは、下の「すべて必須／どれか1つ」でつなぎ方を決めます。
            </p>

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する曜日</p>
              <div className="flex flex-wrap gap-1.5">
                {/*
                  R252: 「すべての曜日」は押す操作として明示する。
                  空（何も選ばない）＝全曜日、という暗黙の読み替えを
                  見た目に載せないと、最後の1つを外したときに全曜日へ
                  広がって見える。
                */}
                <button
                  type="button"
                  aria-pressed={weekdays.length === 0}
                  onClick={() => {
                    setWeekdays([])
                    setWeekdayNotice(null)
                  }}
                  className={`rounded-control border px-2.5 py-1 text-xs transition-colors ${
                    weekdays.length === 0
                      ? 'border-accent bg-accent-soft text-ink font-bold'
                      : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                  }`}
                >
                  すべての曜日
                </button>
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = weekdays.length === 0 || weekdays.includes(day)
                  return (
                    <Button variant="secondary" className={(`rounded-control border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'border-accent bg-accent-soft text-ink'
                          : 'border-hairline text-ink-faint'
                      }`) + ' h-auto whitespace-normal'} key={day} type="button" aria-pressed={on} onClick={() => {
                        // 何も選ばない＝すべての曜日。最初の1つを押したときは
                        // 「その曜日だけ」にする（全部入りから1つ外す、ではない）。
                        if (weekdays.length === 0) {
                          setWeekdays([day])
                          setWeekdayNotice(null)
                          return
                        }
                        if (weekdays.includes(day)) {
                          /*
                           * 最後の1つは外さない。外すと空＝全曜日になり、
                           * 減らすつもりの操作で対象が広がる（R252）。
                           * 受信元の選択（最後の1つは残す）と同じ扱い。
                           */
                          if (weekdays.length === 1) {
                            setWeekdayNotice(
                              '曜日は1つ以上必要です。すべてにする場合は「すべての曜日」を押してください。',
                            )
                            return
                          }
                          setWeekdays(weekdays.filter((d) => d !== day))
                          setWeekdayNotice(null)
                          return
                        }
                        setWeekdays([...weekdays, day].sort((a, b) => a - b))
                        setWeekdayNotice(null)
                      }}>
                      {label}
                    </Button>
                  )
                })}
              </div>
              <p className="text-ink-faint mt-1 text-micro">
                {weekdays.length === 0
                  ? 'すべての曜日で応答します。'
                  : `${weekdays.map((d) => WEEKDAY_LABELS[d]).join('・')}曜だけ応答します。`}
              </p>
              {weekdayNotice ? (
                <p role="status" className="text-ink-secondary mt-1 text-micro">
                  {weekdayNotice}
                </p>
              ) : null}
            </div>

            {!page && <div>
              <RadioCardGroup legend="祝日">
                {HOLIDAY_RULE_LABELS.map((option) => (
                  <RadioCard
                    key={option.value}
                    name="ar-holiday"
                    value={option.value}
                    checked={holidayRule === option.value}
                    onChange={() => setHolidayRule(option.value)}
                    title={option.label}
                    note={option.hint}
                  />
                ))}
              </RadioCardGroup>
            </div>}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ar-from" className="text-ink-faint mb-1 block text-xs">
                  時間帯（JST）
                </label>
                <div className="flex items-center gap-1.5">
                  <TimeField
                    id="ar-from"
                    value={activeFrom}
                    onChange={setActiveFrom}
                    aria-label="時間帯の始まり"
                    className="w-32"
                  />
                  <span className="text-ink-faint text-xs">〜</span>
                  <TimeField
                    aria-label="時間帯の終わり"
                    value={activeUntil}
                    onChange={setActiveUntil}
                    className="w-32"
                  />
                </div>
              </div>
              {!page && <div>
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
              </div>}
            </div>
            <p className="text-ink-faint text-micro leading-relaxed">
              時間帯を空にすると、いつでも返します。22:00〜06:00 のように日をまたぐ指定もできます
              （開始を含み、終了は含みません）。<br />
              「連投を防ぐ」は、その相手へ自動応答を返してからこの分数のあいだ、どのルールでも返さない設定です。
            </p>
            {!page && <div>
              <p className="text-ink-faint mb-1.5 text-xs">対象にするメッセージ</p>
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_KIND_WORDS.map(({ key, label }) => {
                  const on = messageKinds.length === 0 || messageKinds.includes(key)
                  return (
                    <Button variant="primary" className={(`rounded-pill px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'bg-accent-deep text-on-accent'
                          : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                      }`) + ' border-0 h-auto whitespace-normal'} key={key} type="button" aria-pressed={on} onClick={() =>
                        setMessageKinds((prev) => {
                          // 何も選んでいない状態は「全部」を意味する。そこから
                          // 1つ外すには、いったん全部を入れてから外す。
                          const base = prev.length === 0 ? MESSAGE_KIND_WORDS.map((m) => m.key) : prev
                          return base.includes(key)
                            ? base.filter((k) => k !== key)
                            : [...base, key]
                        })
                      }>
                      {label}
                    </Button>
                  )
                })}
              </div>
              <p className="text-ink-faint mt-1 text-micro">
                すべて選んだ状態と、1つも選ばない状態は同じ意味です（種別で絞りません）。
              </p>
            </div>}

            {page && (
              <fieldset className="block">
                <legend className="text-ink-faint mb-1 block text-xs">受信元</legend>
                <div className="flex flex-wrap gap-2">
                  {([['line', 'LINE'], ['email', 'メール']] as const).map(([source, label]) => {
                    const checked = receiveSources.includes(source)
                    return (
                      <Checkbox
                        key={source}
                        checked={checked}
                        onCheckedChange={() => setReceiveSources((current) => {
                          if (checked) return current.length === 1 ? current : current.filter((item) => item !== source)
                          return [...current, source]
                        })}
                      >
                        {label}
                      </Checkbox>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {page && (
              <div className="block">
                <span className="text-ink-faint mb-1 block text-xs">過去28日の受信種別</span>
                <div className="border-hairline rounded-control flex min-h-10 flex-wrap items-center gap-2 border px-3 py-2 text-sm">
                  {draft.receiveSourceCounts == null
                    ? <span className="text-ink-faint">—（未取得）</span>
                    : draft.receiveSourceCounts.length === 0
                      ? <span className="text-ink-faint">受信なし</span>
                      : draft.receiveSourceCounts.map((item) => (
                        <span key={item.source} className="bg-canvas-sunken rounded-pill px-2 py-1 text-xs">
                          {messageKindWord(item.source)} {formatNumber(item.count)}件
                        </span>
                      ))}
                </div>
                <span className="text-ink-faint mt-1 block text-xs">実際の受信履歴から集計しています。</span>
              </div>
            )}

            {!page && <Checkbox
              checked={skipWhenOperatorActive}
              onCheckedChange={setSkipWhenOperatorActive}
              description="「対応中」のときだけ止まり、対応中が解除されるとあらためて動きます。未対応のまま放置されているトークには返します。予約・支払いなどの自動通知は別の送信経路なので止まりません。"
            >
              担当者が対応中のトークでは返さない
            </Checkbox>}

            {!page && <div>
              <RadioCardGroup legend="応答する回数">
                <RadioCard
                  name="ar-once"
                  value="many"
                  checked={!oncePerFriend}
                  onChange={() => setOncePerFriend(false)}
                  title="何度でも応答する"
                />
                <RadioCard
                  name="ar-once"
                  value="once"
                  checked={oncePerFriend}
                  onChange={() => setOncePerFriend(true)}
                  title="1人につき1回だけ応答する"
                  note="このルールで一度応答した人には、以後どのキーワードでも応答しません。上の「連投を防ぐ」は時間をあけるだけですが、こちらは二度と応答しません。"
                />
              </RadioCardGroup>
            </div>}

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する相手</p>
              {page ? (
                <div className="rounded-control border-hairline border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-ink text-sm font-semibold">このルールを使う友だち</p>
                      <p className="text-ink-faint mt-1 text-xs">{friendConditions ? '保存済みの友だち条件あり' : 'すべての友だち'}</p>
                    </div>
                    <Button type="button" onClick={() => setFriendConditionOpen((open) => !open)}>
                      {friendConditionOpen ? '条件を閉じる' : '条件を編集'}
                    </Button>
                  </div>
                  {friendConditionOpen && (
                    <div className="mt-4">
                      <ConditionBuilder
                        value={friendConditions}
                        onChange={setFriendConditions}
                        label="この応答を返す友だち"
                        showCount={false}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <ConditionBuilder
                    value={friendConditions}
                    onChange={setFriendConditions}
                    label="この応答を返す友だち"
                    showCount={false}
                  />
                  <p className="text-ink-faint mt-1 text-xs">条件を入れないと、全員に応答します。</p>
                  <div className="bg-canvas-sunken mt-3 rounded-control p-3 text-xs">
                    <p className="text-ink font-semibold">この条件に当たった受信</p>
                    <p className="text-ink-faint mt-1">過去28日の受信に、この条件をあてはめた結果です。これから来る受信の件数ではありません。</p>
                    <p className="text-ink-faint mt-2">標準互換15軸：名前・メモ・ステータスメッセージ・友だち登録日・タグ・友だち情報・シナリオ・イベント予約・カレンダー予約・共通情報・リマインダ・回答フォーム・最終反応日・その他・対応マーク</p>
                    <p className="text-ink-faint mt-1">この画面だけの6軸：担当者・流入経路・配信状況・予約状況・購入履歴・ブロック状態</p>
                  </div>
                </>
              )}
            </div>
          </div>
          </section>)
}
