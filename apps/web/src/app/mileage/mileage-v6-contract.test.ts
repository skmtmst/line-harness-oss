import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LEGACY = readFileSync(join(HERE, '..', 'scoring', 'page.tsx'), 'utf8')
const LEGACY_NEW = readFileSync(join(HERE, '..', 'scoring', 'new', 'page.tsx'), 'utf8')
const NEW_RULE = readFileSync(join(HERE, 'earning-rules', 'new', 'page.tsx'), 'utf8')
const HISTORY = readFileSync(join(HERE, 'mileage-history-tab.tsx'), 'utf8')
const FRIEND_DETAIL = readFileSync(join(HERE, 'friends', 'detail', 'page.tsx'), 'utf8')
const ADJUSTMENT = readFileSync(join(HERE, 'friends', 'detail', 'mileage-adjustment-dialog.tsx'), 'utf8')
const ACTION_SCORE = readFileSync(join(HERE, 'action-score-tab.tsx'), 'utf8')
const ACTION_SCORE_RULES = readFileSync(join(HERE, 'score-rules', 'page.tsx'), 'utf8')
const REWARDS = readFileSync(join(HERE, 'mileage-rewards-tab.tsx'), 'utf8')
const REWARD_EDITOR = readFileSync(join(HERE, 'rewards', 'reward-editor.tsx'), 'utf8')
const BROADCAST_NEW = readFileSync(join(HERE, '..', 'broadcasts', 'new', 'page.tsx'), 'utf8')
const SEGMENT = readFileSync(join(HERE, '..', '..', 'lib', 'segment-condition.ts'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')
const MENU = readFileSync(join(HERE, '..', '..', 'lib', 'menu.ts'), 'utf8')

describe('V6 マイルの正本URLと概念分離', () => {
  it('マイルの正本を /mileage にし、旧URLを恒久転送する', () => {
    expect(MENU).toContain("{ href: '/mileage', label: 'マイル'")
    expect(LEGACY).toContain("permanentRedirect('/mileage')")
    expect(LEGACY_NEW).toContain("permanentRedirect('/mileage/earning-rules/new')")
  })

  it('本文タイトルを重ねず、実装済みの行動スコアをタブへ出す', () => {
    expect(PAGE).toContain('data-mileage-design="v6"')
    expect(PAGE).toContain("{ key: 'balances', label: '友だちの残高' }")
    expect(PAGE).toContain("{ key: 'earning-rules', label: 'たまる決めごと' }")
    expect(PAGE).toContain("{ key: 'history', label: '履歴' }")
    expect(PAGE).toContain("{ key: 'score', label: '行動スコア' }")
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('準備中')
  })

  it('履歴と友だち別明細をV6の実Nodeへ接続する', () => {
    expect(HISTORY).toContain('data-design-node="MvZm5"')
    expect(HISTORY).toContain('api.mileage.history')
    expect(HISTORY).toContain("kind=\"error\"")
    expect(FRIEND_DETAIL).toContain('data-design-node="HIU5O"')
    expect(FRIEND_DETAIL).toContain('api.friends.mileage')
    expect(FRIEND_DETAIL).toContain('usePageTitle')
    expect(FRIEND_DETAIL).not.toContain('準備中')
  })

  it('残高は共通トップバーで選んだLINEアカウントだけを取得する', () => {
    expect(PAGE).toContain('selectedAccountId')
    expect(PAGE).toContain('accountId: accountAtRequest')
    expect(PAGE).toContain('accountAtRequest !== latestAccountRef.current')
    expect(PAGE).not.toContain('<option value="all">全アカウント横断</option>')
  })

  it('一覧の読込・空・失敗を言い分け、失効値を取得済みに見せない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('まだ決めごとがありません')
    expect(PAGE).toContain('もうすぐ消えるマイル')
    expect(PAGE).toContain('badge="未取得"')
    expect(PAGE).not.toContain('該当するユーザーがいません')
  })

  it('既存の更新APIから決めごとの停止と再開を操作できる', () => {
    expect(PAGE).toContain("updateRule(rule, { isActive: !rule.isActive })")
    expect(PAGE).toContain("rule.isActive ? '決めごとを停止' : '決めごとを再開'")
    expect(PAGE).toContain("rule.isActive ? '動いています' : '止めています'")
  })

  it('作成画面も mileage_rules のAPIと正本URLを使う', () => {
    expect(NEW_RULE).toContain('api.mileage.createRule')
    expect(NEW_RULE).toContain("parent={['マイル', '/mileage?tab=earning-rules']}")
    expect(NEW_RULE).not.toContain('api.scoring.create')
  })

  it('手動増減はV6実Node・確認段階・冪等キーを通して追記する', () => {
    expect(FRIEND_DETAIL).toContain('<MileageAdjustmentDialog')
    expect(ADJUSTMENT).toContain('designNode="vz0Ji"')
    expect(ADJUSTMENT).toContain("useState<'input' | 'confirm'>('input')")
    expect(ADJUSTMENT).toContain('変更前')
    expect(ADJUSTMENT).toContain('変更量')
    expect(ADJUSTMENT).toContain('変更後')
    expect(ADJUSTMENT).toContain('crypto.randomUUID()')
    expect(ADJUSTMENT).toContain('reasonCategory')
    expect(ADJUSTMENT).toContain('sourceReferenceId')
    expect(ADJUSTMENT).toContain('setAdjustmentPolicy')
    expect(ADJUSTMENT).toContain('承認境界を保存')
    expect(API).toContain("'Idempotency-Key': idempotencyKey")
    expect(API).toContain("'X-Confirm-Irreversible': 'mileage-adjustment'")
  })

  it('未接続の通知と失効を実行済みに見せない', () => {
    expect(ADJUSTMENT).toContain('送信・失効台帳が接続されるまで実行しません')
    expect(ADJUSTMENT).not.toContain('「マイルが付きました」と届きます')
    expect(ADJUSTMENT).toContain('変更後の残高が0未満になる操作は実行しません')
    expect(ADJUSTMENT).not.toContain('API error:')
  })

  it('行動スコアを既存の現在値・履歴から選択アカウント単位で表示する', () => {
    expect(ACTION_SCORE).toContain('data-design-node="z3PB2"')
    expect(ACTION_SCORE).toContain('api.actionScores.friends')
    /*
      断りの文はV6の面（`z3PB2`）の言い方へそろえた。確かめたいのは
      **「スコアはマイルではない」と3つの言い方で断ること**なので、
      1文ではなく3つとも見る。
    */
    expect(ACTION_SCORE).toContain('スコアはマイルではありません')
    expect(ACTION_SCORE).toContain('お客様には見せず、交換もできません')
    expect(ACTION_SCORE).toContain('マイル残高はスコアで増えも減りもしません')
    expect(ACTION_SCORE).toContain('kind="loading"')
    expect(ACTION_SCORE).toContain('kind="empty"')
    expect(ACTION_SCORE).toContain('kind="error"')
    expect(API).toContain('/api/action-scores/friends')
    expect(ACTION_SCORE).toContain('/mileage/score-rules')
  })

  it('スコアのルールをアカウント別の下書き・テスト・公開へ接続する', () => {
    expect(ACTION_SCORE_RULES).toContain('data-design-node="s6MBc"')
    expect(ACTION_SCORE_RULES).toContain("usePageTitle('スコアのルール')")
    expect(ACTION_SCORE_RULES).toContain('api.actionScores.rules')
    expect(ACTION_SCORE_RULES).toContain('api.actionScores.saveDraft')
    expect(ACTION_SCORE_RULES).toContain('api.actionScores.testRules')
    expect(ACTION_SCORE_RULES).toContain('api.actionScores.publishRules')
    expect(ACTION_SCORE_RULES).toContain('api.actionScores.stopRules')
    expect(ACTION_SCORE_RULES).toContain('同じ元の記録は必ず1回だけ')
    expect(ACTION_SCORE_RULES).toContain('LINEの既読は取得できない')
    expect(ACTION_SCORE_RULES).not.toContain('準備中')
    expect(API).toContain('/api/action-scores/rules/draft')
    expect(API).toContain("'X-Confirm-Irreversible': 'action-score-rules-publish'")
  })

  it('スコア層を友だち検索と配信の同じ共通条件へ渡す', () => {
    expect(ACTION_SCORE).toContain('/friends?')
    expect(ACTION_SCORE).toContain('/broadcasts/new?')
    expect(SEGMENT).toContain("case 'score_range'")
    expect(BROADCAST_NEW).toContain("type: 'score_range'")
    expect(BROADCAST_NEW).toContain('initialCondition={initialCondition}')
  })

  it('使い道を一覧・作成・公開まで実データへ接続する', () => {
    expect(PAGE).toContain("{ key: 'rewards', label: '使い道' }")
    expect(REWARDS).toContain('data-design-node="qlVLJ"')
    expect(REWARDS).toContain('api.mileage.rewardOverview')
    expect(REWARDS).toContain('api.mileage.reorderRewards')
    expect(REWARD_EDITOR).toContain('data-design-node="p9CcEB"')
    expect(REWARD_EDITOR).toContain('api.mileage.createReward')
    expect(REWARD_EDITOR).toContain('api.mileage.updateRewardDraft')
    expect(REWARD_EDITOR).toContain('api.mileage.publishReward')
    expect(REWARD_EDITOR).toContain('api.mileage.importRewardCodes')
  })

  it('公開版を直接書き換えず、交換コードを再表示しない', () => {
    expect(REWARD_EDITOR).toContain('api.mileage.createRewardDraft')
    expect(REWARD_EDITOR).toContain('公開中の版はそのまま保たれます')
    expect(REWARD_EDITOR).toContain('保存後は安全のため画面へ戻しません')
    expect(REWARD_EDITOR).toContain("set('couponCodes', '')")
    expect(REWARD_EDITOR).not.toContain('reward.code')
  })
})
