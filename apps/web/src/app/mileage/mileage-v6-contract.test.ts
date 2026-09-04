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

  it('APIの入れ子が欠けても画面を落とさず、0件とも書かない', () => {
    expect(HISTORY).toContain('mileagePaginationTotal(result)')
    expect(HISTORY).not.toContain('result?.pagination.total')
    expect(PAGE).toContain('mileagePaginationTotal(overview)')
    expect(PAGE).not.toContain('overview?.pagination.total')
    expect(FRIEND_DETAIL).toContain('mileageRewardedActions(mileage.insights)')
    expect(FRIEND_DETAIL).toContain('mileageConnectedAccounts(mileage.connections)')
    expect(FRIEND_DETAIL).toContain('付与記録の回数は未取得')
    expect(FRIEND_DETAIL).toContain('接続先はありません')
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
    // 2026-09-02: 一覧をカード格子から設計の表へ移し、状態を共通Chipで出す。
    // 言い方は変えていない。
    expect(PAGE).toContain('<Chip tone="ok">動いています</Chip> : <Chip>止めています</Chip>')
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
    /* 断り文は下の「3つの言い方で断る」で見る。ここは口と印だけ。 */
    expect(ACTION_SCORE).toContain('kind="loading"')
    expect(ACTION_SCORE).toContain('kind="empty"')
    expect(ACTION_SCORE).toContain('kind="error"')
    expect(API).toContain('/api/action-scores/friends')
  })

  it('スコアの帯を友だち検索と配信の同じ共通条件へ渡す', () => {
    expect(ACTION_SCORE).toContain('/friends?')
    expect(ACTION_SCORE).toContain('/broadcasts/new?')
    expect(SEGMENT).toContain("case 'score_range'")
    expect(BROADCAST_NEW).toContain("type: 'score_range'")
    expect(BROADCAST_NEW).toContain('initialCondition={initialCondition}')
  })

  it('手動増減の失敗でAPI番号や内部文をそのまま出さない', () => {
    expect(ADJUSTMENT).toContain('mileageAdjustmentErrorMessage')
    expect(ADJUSTMENT).toContain("error.status === 405")
    expect(ADJUSTMENT).toContain('この環境ではマイル変更を実行できません。')
    expect(ADJUSTMENT).toContain('画面を読み直してからやり直してください。')
    expect(ADJUSTMENT).toContain("error.status === 428")
    expect(ADJUSTMENT).toContain('確認手順が完了していません。')
    expect(ADJUSTMENT).not.toContain("error instanceof ApiError || error instanceof Error ? error.message")
  })

  it('スコアはマイルではないと3つの言い方で断る', () => {
    /*
      設計 `z3PB2` の断り文そのまま。**「顧客には表示されず」だけでは足りない。**
      「マイルが減るのでは」と聞かれたときに答えられるよう、
      **交換できないこと・残高が動かないこと**を先に言う。
      1文ではなく3つとも見る。言い換えると1つ落ちても気づけない。
    */
    expect(ACTION_SCORE).toContain('スコアはマイルではありません')
    expect(ACTION_SCORE).toContain('お客様には見せず、交換もできません')
    expect(ACTION_SCORE).toContain('マイル残高はスコアで増えも減りもしません')
  })

  it('点数の集まりを「帯」と呼ぶ', () => {
    /*
      設計 `z3PB2` は「帯」。「層」は人を分ける言い方に聞こえるので使わない
      （§7 #48 の表記ゆれ）。CSVの見出しと表の見出しも同じ言葉にする。
    */
    expect(ACTION_SCORE).not.toContain('層')
    for (const word of ['この帯の人を見る', 'この帯に配信する', '帯または検索条件']) {
      expect(ACTION_SCORE).toContain(word)
    }
  })
})
