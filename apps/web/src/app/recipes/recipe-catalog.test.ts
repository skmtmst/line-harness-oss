import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURES } from '@/lib/feature-settings'
import {
  CARE_ITEMS,
  CLONE_COUNT_UNAVAILABLE,
  CLONE_UNAVAILABLE_NOTE,
  ITEMS_UNDECIDED_NOTE,
  RECIPES,
  createButtonLabel,
  featureSummary,
  missingFeatures,
  prefixedName,
  recipeAction,
  requirementIsOn,
} from './recipe-catalog'

/**
 * 設計 ★V6 34-2（`y0P0Qx`）/ 34-3（`D5UaX`）のレシピを、文言ごと固定する。
 *
 * ここで守りたいのは 1 点——**無いものを数にしない**こと。
 * 複製回数も、決まっていない内訳も、0 と書けば別の意味になる。
 */

const ALL_ON = { ...DEFAULT_FEATURES } as Record<string, boolean>

describe('レシピは設計の3本', () => {
  it('名前と目的が設計 y0P0Qx と一致する', () => {
    expect(RECIPES.map((r) => [r.name, r.purpose])).toEqual([
      ['新規登録 7日間フォロー', '友だちが増えたあと、7日かけて関係を作ります。'],
      ['予約のリマインド', '前日と当日に、予約を思い出してもらいます。'],
      ['ウェビナーの案内と当日', '申し込みから当日の入室まで、順に案内します。'],
    ])
  })

  it('作られるものの1行が設計どおり', () => {
    expect(RECIPES.map((r) => r.creates)).toEqual([
      'タグ1つ、友だち追加時のルール1本、シナリオ7通、テンプレート7本',
      'タグ1つ、リマインダ2本、テンプレート2本',
      'タグ2つ、ウェビナー1件、リマインダ3本、テンプレート4本',
    ])
  })

  it('どのレシピにも友だち属性が要る', () => {
    for (const recipe of RECIPES) {
      expect(recipe.requirements.some((r) => r.label === '友だち属性')).toBe(true)
    }
  })
})

describe('必要な機能', () => {
  /*
    **鍵の無い機能を「オフ」と読まない。** 友だち属性のように切れない機能は、
    機能設定に行が無い。行が無いことをオフと読むと、どのレシピも使えなくなる。
  */
  it('切れない機能はいつでもオン', () => {
    expect(requirementIsOn({ label: '友だち属性', feature: null }, {})).toBe(true)
  })

  it('全部オンなら足りないものは無い', () => {
    expect(missingFeatures(RECIPES[0], ALL_ON)).toEqual([])
    expect(featureSummary(RECIPES[0], ALL_ON)).toBe('すべてオンなので、機能の面では作れます。')
  })

  it('オフの機能があれば、どれをオンにすればよいかまで言う', () => {
    const off = { ...ALL_ON, webinars: false }
    expect(missingFeatures(RECIPES[2], off)).toEqual(['ウェビナー'])
    expect(featureSummary(RECIPES[2], off)).toBe(
      'ウェビナーがオフです。「機能設定」でオンにすると使えます。',
    )
  })
})

describe('「このレシピで作る」の出し方', () => {
  /*
    **押せない理由を2つに分ける。** 機能がオフなのは運用者が直せる。
    口が無いのは直せない。同じ言い方にすると、直せるものまで諦めさせる。
  */
  it('機能がオフのときは、機能設定へ誘う言い方にする', () => {
    const action = recipeAction(RECIPES[2], { ...ALL_ON, webinars: false }, true)
    expect(action.state).toBe('needs-feature')
    expect(action.label).toBe('機能をオンにしてから')
    expect(action.reason).toBe('「機能設定」でウェビナーをオンにすると使えます')
    expect(action.href).toBeNull()
  })

  it('作る仕組みが無いときは、そう言って押せなくする', () => {
    const action = recipeAction(RECIPES[0], ALL_ON, false)
    expect(action.state).toBe('no-api')
    expect(action.href).toBeNull()
    expect(action.reason).toContain('まだ入っていません')
  })

  it('全部そろえば複製画面へ進める', () => {
    const action = recipeAction(RECIPES[0], ALL_ON, true)
    expect(action.state).toBe('ready')
    expect(action.label).toBe('このレシピで作る')
    expect(action.href).toBe('/recipes/clone?id=signup-7day-follow')
  })

  it('機能のオフが、口の有無より先に出る', () => {
    // どちらも欠けているとき、先に言うのは運用者が直せるほう。
    const action = recipeAction(RECIPES[2], { ...ALL_ON, webinars: false }, false)
    expect(action.state).toBe('needs-feature')
  })
})

describe('数えられないものを数にしない', () => {
  it('複製回数は「0回」ではなく、数えられないと言う', () => {
    expect(CLONE_COUNT_UNAVAILABLE).not.toMatch(/\d/)
    expect(CLONE_COUNT_UNAVAILABLE).toContain('まだ数えられません')
  })

  it('内訳が決まっていないレシピを「0件」と書かない', () => {
    const webinar = RECIPES[2]
    expect(webinar.items).toBeNull()
    expect(ITEMS_UNDECIDED_NOTE).toContain('まだ決まっていません')
    // 件数だけは設計の1行から分かるので、そちらは出してよい。
    expect(webinar.itemCount).toBe(10)
  })

  it('複製できない理由に「準備中」と書かない', () => {
    expect(CLONE_UNAVAILABLE_NOTE).not.toContain('準備中')
    expect(CLONE_UNAVAILABLE_NOTE).toContain('まだ入っていません')
  })
})

describe('34-3 複製画面', () => {
  it('内訳の各行が設計 D5UaX と一致する（7日間フォロー）', () => {
    expect(RECIPES[0].itemCount).toBe(16)
    expect(RECIPES[0].items?.map((i) => [i.kind, i.name])).toEqual([
      ['タグ', '新規'],
      ['友だち追加時のルール', 'はじめて'],
      ['シナリオ', '新規登録 7日間フォロー'],
      ['テンプレート', '1通目 はじめまして ほか6本'],
      ['タグ', 'フォロー完了'],
    ])
    expect(RECIPES[0].itemsRest).toBe('ほか 11件（テンプレート6本、シナリオの各通の設定5件）')
  })

  it('あたまに付ける文字は、空のときは何も足さない', () => {
    expect(prefixedName('', '新規登録 7日間フォロー')).toBe('新規登録 7日間フォロー')
    expect(prefixedName('  ', '新規登録 7日間フォロー')).toBe('新規登録 7日間フォロー')
    expect(prefixedName('2026春', '新規登録 7日間フォロー')).toBe('2026春 新規登録 7日間フォロー')
  })

  it('件数が決まっていないレシピのボタンは、件数を言わない', () => {
    expect(createButtonLabel(RECIPES[0])).toBe('16件を下書きで作る')
    expect(createButtonLabel({ ...RECIPES[0], itemCount: null })).toBe('下書きで作る')
  })

  it('気をつけることは設計の 3 行', () => {
    expect(CARE_ITEMS).toHaveLength(3)
  })
})
