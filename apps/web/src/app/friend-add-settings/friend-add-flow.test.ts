import { describe, expect, it } from 'vitest'

import type { FriendAddRuleDefinition } from '@/lib/api'
import { friendAddFlowSteps, friendAddReaddLines } from './friend-add-flow'

const BASE_DEFINITION: FriendAddRuleDefinition = {
  routeIds: ['route-1'],
  scenarioId: 'sc-1',
  messageType: 'text',
  messageText: '友だち追加ありがとうございます。',
  timing: 'immediate',
  actions: [],
  friendCondition: '',
  activeFrom: null,
  activeUntil: null,
  deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
  resendSuppressionHours: 24,
  unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeWindows: [{ start: '08:00', end: '21:00' }],
}

describe('IDEA-09 友だち追加時配信の流れ説明', () => {
  it('経路→初回案内→付く属性→次の配信の順で、実設定の値を出す', () => {
    const steps = friendAddFlowSteps({
      isFallback: false,
      routeNames: ['店頭QR', 'Instagram広告'],
      missingRouteCount: 0,
      definition: {
        ...BASE_DEFINITION,
        actions: [
          { type: 'add_tag', label: 'タグ「新規友だち」を付ける', targetId: 'tag-1' },
          { type: 'start_scenario', label: 'シナリオ「フォローアップ」を開始する', targetId: 'sc-2' },
        ],
      },
      scenarioName: 'ウェルカムシナリオ',
    })
    expect(steps.map((step) => step.key)).toEqual(['route', 'firstMessage', 'attributes', 'nextDelivery'])
    expect(steps[0].title).toBe('店頭QR、Instagram広告')
    expect(steps[0].detail).toContain('URL・QR')
    expect(steps[0].detail).toContain('経路が分からなかった人')
    expect(steps[1].title).toBe('初回案内（テキスト）')
    expect(steps[1].detail).toContain('登録直後に届きます')
    expect(steps[2].title).toBe('付く属性')
    expect(steps[2].detail).toBe('タグ「新規友だち」を付ける')
    expect(steps[3].title).toBe('次の配信')
    expect(steps[3].detail).toContain('シナリオ「ウェルカムシナリオ」を開始します')
    expect(steps[3].detail).toContain('シナリオ「フォローアップ」を開始する')
  })

  it('設定していない内容は例示で埋めず「ありません」と書く', () => {
    const steps = friendAddFlowSteps({
      isFallback: false,
      routeNames: ['店頭QR'],
      missingRouteCount: 0,
      definition: { ...BASE_DEFINITION, messageText: '', actions: [] },
      scenarioName: 'ウェルカムシナリオ',
    })
    expect(steps[1].detail).toContain('文面は未設定です')
    expect(steps[2].detail).toBe('タグの追加・解除はありません。')
    // 固定例示の残り（画像・ボタン・決まった時刻）を出さない
    expect(steps[1].detail).not.toContain('画像')
    expect(steps[1].detail).not.toContain('ボタン')
    expect(steps.map((step) => step.detail).join('')).not.toContain('10:00')
  })

  it('受け皿ルールは経路不明の人向けであることを示す', () => {
    const steps = friendAddFlowSteps({
      isFallback: true,
      routeNames: [],
      missingRouteCount: 0,
      definition: BASE_DEFINITION,
      scenarioName: '共通案内シナリオ',
    })
    expect(steps[0].title).toBe('経路が分からなかった人（受け皿）')
    expect(steps[0].detail).toContain('基本の追加URL')
  })

  it('停止・削除済みの経路は件数を明示する', () => {
    const steps = friendAddFlowSteps({
      isFallback: false,
      routeNames: ['店頭QR'],
      missingRouteCount: 2,
      definition: BASE_DEFINITION,
      scenarioName: 'ウェルカムシナリオ',
    })
    expect(steps[0].detail).toContain('停止・削除済みの経路が2件含まれています')
  })

  it('シナリオ未選択・削除済みを区別して書く', () => {
    const unset = friendAddFlowSteps({
      isFallback: false, routeNames: ['A'], missingRouteCount: 0,
      definition: { ...BASE_DEFINITION, scenarioId: null }, scenarioName: null,
    })
    expect(unset[3].detail).toContain('配信シナリオは未選択です')
    const deleted = friendAddFlowSteps({
      isFallback: false, routeNames: ['A'], missingRouteCount: 0,
      definition: BASE_DEFINITION, scenarioName: null,
    })
    expect(deleted[3].detail).toContain('削除済みのシナリオを指しています')
  })

  it('初回の1通を送らない設定は登録だけ行うと書く', () => {
    const steps = friendAddFlowSteps({
      isFallback: false, routeNames: ['A'], missingRouteCount: 0,
      definition: {
        ...BASE_DEFINITION,
        deliveryChoices: { sendWelcomeMessage: false, startScenario: true, runActions: true },
      },
      scenarioName: 'ウェルカムシナリオ',
    })
    expect(steps[1].detail).toBe('最初の1通は送らず、シナリオへの登録だけを行います。')
  })
})

describe('IDEA-09 再追加時に動く／動かない処理の説明', () => {
  it('はじめての人の設定は再追加には動かないと書く', () => {
    const lines = friendAddReaddLines({
      friendKind: 'first_time',
      status: 'published',
      definition: BASE_DEFINITION,
    })
    expect(lines.join('')).toContain('再追加・ブロック解除で戻った人には動きません')
    expect(lines.join('')).toContain('24時間に1回')
  })

  it('再追加「何も配信しない」は案内・シナリオを止め、アクションだけ実行されると書く', () => {
    const lines = friendAddReaddLines({
      friendKind: 'returning',
      status: 'published',
      definition: {
        ...BASE_DEFINITION,
        returningMode: 'none',
        actions: [{ type: 'add_tag', label: 'タグ「再来」を付ける', targetId: 'tag-9' }],
      },
    })
    expect(lines.join('')).toContain('初回案内とシナリオを動かしません')
    expect(lines.join('')).toContain('設定したアクションは実行されます')
  })

  it('再追加「はじめてと同じ内容」「別のシナリオ・開始位置」を書き分ける', () => {
    const same = friendAddReaddLines({
      friendKind: 'returning', status: 'published',
      definition: { ...BASE_DEFINITION, returningMode: 'same' },
    })
    expect(same.join('')).toContain('はじめての人と同じ案内・シナリオ・アクションが動きます')
    const other = friendAddReaddLines({
      friendKind: 'returning', status: 'published',
      definition: { ...BASE_DEFINITION, returningMode: 'other', startPosition: 'resume' },
    })
    expect(other.join('')).toContain('前回配信した次から')
    const otherFromStart = friendAddReaddLines({
      friendKind: 'returning', status: 'published',
      definition: { ...BASE_DEFINITION, returningMode: 'other', startPosition: 'beginning' },
    })
    expect(otherFromStart.join('')).toContain('最初から')
  })

  it('停止中・下書きは実行されないことを先に書く', () => {
    const stopped = friendAddReaddLines({
      friendKind: 'first_time', status: 'stopped', definition: BASE_DEFINITION,
    })
    expect(stopped[0]).toContain('停止中です')
    const draft = friendAddReaddLines({
      friendKind: 'first_time', status: 'draft', definition: BASE_DEFINITION,
    })
    expect(draft[0]).toContain('下書きです')
  })

  it('再送制限なしは「制限しません」と書く', () => {
    const lines = friendAddReaddLines({
      friendKind: 'first_time', status: 'published',
      definition: { ...BASE_DEFINITION, resendSuppressionHours: 0 },
    })
    expect(lines.join('')).toContain('同じ人への再送は制限しません')
  })
})
