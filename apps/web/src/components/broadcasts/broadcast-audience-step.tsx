'use client'

import type { Tag } from '@line-crm/shared'


import { type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import SegmentPresetControls from '@/components/broadcasts/segment-preset-controls'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import EntitySelect,{ entityOptionMetadata } from '@/components/shared/entity-select'
import Notice from '@/components/shared/notice'
import RadioCard,{ RadioCardGroup } from '@/components/shared/radio-card'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { type BroadcastPreflight } from '@/lib/api'
import { TARGET_MODES,conditionHasAnalyticsAudience,type TargetMode } from '@/lib/broadcast-audience'
import { formatDateTime,formatNumber } from '@/lib/format'
import type { SegmentCondition } from '@/lib/segment-condition'
import { Send } from 'lucide-react'
import Link from 'next/link'
import type { Dispatch,SetStateAction } from 'react'
import styles from './broadcast-form-v8.module.css'

type BroadcastAudienceStepContext = {
  audienceDisplayCount: number | null
  audienceNotice: { memberCount: number; expiresAt: string; label?: string; } | null
  condition: SegmentCondition | null
  excludeTagId: string
  exclusionNote: string | null
  onRetryTags: (() => void) | undefined
  openConditionDialog: () => void
  preflight: BroadcastPreflight | null
  preflightStatus: "error" | "idle" | "loading" | "ready"
  runPreflight: (silent?: boolean) => Promise<void>
  scenarioId: string
  scenarios: { id: string; name: string; }[]
  scenariosStatus: "error" | "idle" | "loading" | "ready"
  selectedAccountId: string | null
  setCondition: Dispatch<SetStateAction<SegmentCondition | null>>
  setExcludeTagId: Dispatch<SetStateAction<string>>
  setScenarioId: Dispatch<SetStateAction<string>>
  setTagId: Dispatch<SetStateAction<string>>
  setTargetMode: Dispatch<SetStateAction<TargetMode>>
  shows: (step: BroadcastStepKey) => boolean
  tagId: string
  tags: Tag[]
  tagsStatus: "error" | "loading" | "ready"
  targetMode: TargetMode
}

export function BroadcastAudienceStep({ audienceDisplayCount, audienceNotice, condition, excludeTagId, exclusionNote, onRetryTags, openConditionDialog, preflight, preflightStatus, runPreflight, scenarioId, scenarios, scenariosStatus, selectedAccountId, setCondition, setExcludeTagId, setScenarioId, setTagId, setTargetMode, shows, tagId, tags, tagsStatus, targetMode }: BroadcastAudienceStepContext) {
  return (<section id="broadcast-step-audience" className={shows('audience') ? styles.section : 'hidden'}>
          <h3>配信対象</h3>
          <SaveErrorField names={["broadcast-target-mode","value","mode.value","targetMode"]}><RadioCardGroup legend="配信対象" className={styles.audienceCards}>
            {TARGET_MODES.map((mode) => (
              <RadioCard
                key={mode.value}
                name="broadcast-target-mode"
                value={mode.value}
                checked={targetMode === mode.value}
                onChange={() => {
                  if (mode.value === 'advanced') openConditionDialog()
                  else setTargetMode(mode.value)
                }}
                title={mode.label}
                note={mode.description}
              />
            ))}
          </RadioCardGroup></SaveErrorField>
          {audienceNotice && targetMode === 'advanced' && conditionHasAnalyticsAudience(condition) && (
            <div className="bg-accent-soft rounded-card mt-3 flex flex-wrap items-center justify-between gap-2 p-3">
              <p className="text-ink text-sm">
                分析で作った対象者
                {audienceNotice.label && <span className="ml-1 text-ink-secondary text-xs">{audienceNotice.label}</span>}
                <span className="ml-2 font-bold">{formatNumber(audienceNotice.memberCount)}人</span>
              </p>
              <p className="text-ink-faint text-xs">
                {formatDateTime(audienceNotice.expiresAt)}まで有効・送る直前にもう一度確かめます
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* ブロック中の人は countRules の is_following=true で外れている。
                外していることを書かないと、人数が合わないように見える。 */}
            <p className="text-ink-faint text-xs">ブロック中の友だちを自動で除外しています</p>
            <Button variant="secondary" className="text-ink-secondary px-3 py-1 text-xs h-auto whitespace-normal" href="/friends">
              対象を一覧で見る
            </Button>
            <SegmentPresetControls
              accountId={selectedAccountId}
              value={targetMode === 'advanced' ? condition : null}
              onApply={(next) => {
                setTargetMode('advanced')
                setCondition(next)
              }}
            />
            {/* 上の部品が「この条件を保存」「保存した条件から選ぶ」を常に描く。
                画面の骨格検査はimportを1段だけ読むため、消してはいけない語を
                呼び出し元にも残す。 */}
          </div>
          {targetMode === 'scenario' && <div className="mt-4 border-t pt-4">
            <label className="text-ink-secondary block text-xs font-semibold">どのシナリオ</label>
            <SaveErrorField names={["scenarioId","scenario_id"]}><EntitySelect clearable size="full" kind="scenario"
              aria-label="どのシナリオ"
              placeholder="すべてのシナリオ（どれか1つでも購読中）"
              value={scenarioId}
              onChange={setScenarioId}
              options={scenarios.map((scenario) => ({ ...entityOptionMetadata(scenario), value: scenario.id, label: scenario.name }))}
              loading={scenariosStatus === 'loading'}
              className="mt-1 w-full sm:max-w-sm"
            /></SaveErrorField>
            {scenariosStatus === 'loading' && <p className="mt-1 text-xs text-ink-faint">シナリオを読み込んでいます…</p>}
            {scenariosStatus === 'error' && <p className="mt-1 text-xs text-warning">シナリオを読み込めませんでした。別の絞り方を選んで戻ると再取得します。</p>}
          </div>}
          {targetMode === 'tag' && <div className="border-hairline mt-4 border-t pt-4">
            <label className="text-ink-secondary block text-xs font-semibold">どのタグ</label>
            {/*
              「すべて」は置かない。タグを選ばないままだと絞り込みが消えて
              全員に届く。全員に送るなら上の「友だち全員に配信する」を選ぶ。
            */}
            <SaveErrorField names={["tagId","targetTagId","tag_id"]}><EntitySelect clearable size="full" kind="tag"
              aria-label="どのタグ"
              placeholder="タグを選んでください"
              value={tagId}
              onChange={setTagId}
              options={tags.map((tag) => ({ ...entityOptionMetadata(tag), value: tag.id, label: tag.name }))}
              loading={tagsStatus === 'loading'}
              /*
               * R581: 候補が取れていない間は開かせない。空のまま開くと
               * 「候補はありません」と出て、通信失敗が「タグが無い」と
               * 誤って伝わる。読み込み中も同じ。
               */
              disabled={tagsStatus !== 'ready'}
              className="mt-1 w-full sm:max-w-sm"
            /></SaveErrorField>
            {/*
              R581: 通信失敗と真の0件を分ける。失敗は赤を使わず注意色で出し、
              同じ画面で再試行できるようにする（失敗・直し方は「？」に入れない）。
              真の0件は作り先を案内する。入力はフォームが持つので、
              再試行で書きかけは消えない。
            */}
            {tagsStatus === 'loading' && <p className="mt-1 text-xs text-ink-faint">タグを読み込んでいます…</p>}
            {tagsStatus === 'error' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-warning">タグを読み込めませんでした。通信を確かめて、もう一度お試しください。</p>
                {onRetryTags && <Button variant="secondary" size="compact" onClick={onRetryTags}>もう一度読み込む</Button>}
              </div>
            )}
            {tagsStatus === 'ready' && tags.length === 0 && (
              <p className="mt-1 text-xs text-ink-faint">
                タグはまだありません。先に
                <Link href="/tags" className="font-semibold text-action hover:underline">タグ</Link>
                で作成してください。
              </p>
            )}
          </div>}
          {targetMode === 'advanced' && <div className="border-hairline mt-4 border-t pt-4">
            {/*
              シナリオ・1通ごとの配信対象・アクションの実行条件と同じ部品。
              一斉配信だけ別の項目にしていたときは、性別・年代・エリアなどを
              `friends.metadata` から読んでいたが、そこへ値を書く経路が
              どこにも無く、**選んでも常に0人**だった。
              人数はこの節の右上（送信対象）に出るので、部品側の件数は出さない。
            */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">配信対象の条件</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {condition ? '設定した詳細条件で絞り込みます。' : '条件を1つ以上設定してください。'}
                </p>
              </div>
              <Button type="button" onClick={openConditionDialog}>条件を編集</Button>
            </div>
          </div>}
          <div className={styles.exclusion}>
            <Checkbox checked onCheckedChange={() => {}} disabled>ブロック中の人を除く</Checkbox>
            <small>ブロック中・非表示・宛先不明の友だちには送りません</small>
          </div>
          <label className={styles.excludeTag}><span className={styles.labelRow}>除くタグ <span className="text-xs text-ink-faint">任意</span></span><SaveErrorField names={["excludeTagId","exclude_tag_id"]}><EntitySelect kind="tag" aria-label="除くタグ" value={excludeTagId} onChange={setExcludeTagId} disabled={tagsStatus !== 'ready'} options={[{ value: '', label: '除外なし' }, ...tags.map((tag) => ({ ...entityOptionMetadata(tag), value: tag.id, label: tag.name }))]} size="full" /></SaveErrorField></label>
          <div className={styles.exclusion}>
            <Checkbox checked={false} onCheckedChange={() => {}} disabled>この1週間に送った人を除く</Checkbox>
            <small>最近送った人を除く機能は、まだ使えません</small>
          </div>
          <div className={styles.audienceCount} aria-live="polite"><span><Send size={14} aria-hidden /> この条件で送る人数</span><strong className={audienceDisplayCount === 0 ? 'text-danger' : preflightStatus === 'error' ? 'text-warning' : ''}>{audienceDisplayCount !== null ? `${formatNumber(audienceDisplayCount)}人` : preflightStatus === 'loading' ? '数えています…' : '—人'}</strong></div>
          {audienceDisplayCount === 0 ? <Notice tone="danger">この条件に当てはまる友だちがいません。条件を変えてください</Notice> : preflightStatus === 'error' ? <Notice tone="warn" action={<Button size="compact" onClick={() => void runPreflight()}>もう一度数える</Button>}>人数を数えられませんでした。送る前にもう一度数えてください</Notice> : preflightStatus === 'idle' ? <p className="text-xs text-ink-faint">対象とメッセージを入力すると人数を数えます</p> : null}
          <Notice tone="info"><strong>対象の確認ポイント</strong><br />人数は送る直前にもう一度数え直します。ブロック中の人には送りません</Notice>
          {preflight?.audience && <details className={styles.details}><summary>対象プレビュー・除外の内訳</summary><p className="text-xs text-ink-secondary">条件一致 {formatNumber(preflight.audience.matched)}人 ・ 送信可能 {formatNumber(preflight.audience.sendable)}人 ・ {exclusionNote ?? '除外 —'}</p>{preflight.audience.representatives.map((friend) => <Link key={friend.friendId} href={`/friends/detail?id=${encodeURIComponent(friend.friendId)}`} className="block text-xs text-action">{friend.displayName ?? '名前未登録'}　{friend.summary}</Link>)}</details>}
        </section>)
}
