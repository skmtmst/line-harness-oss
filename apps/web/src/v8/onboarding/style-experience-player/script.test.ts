import { describe, expect, it } from 'vitest'
import { ACCOUNT_STYLES, STYLE_DEFAULT_METRIC_IDS, type AccountStyle } from '@line-crm/shared'
import { styleTerm } from '@/lib/terms'
import { STYLE_CONFIG } from '@/v8/style-dashboard'
import { defaultCards } from '../../../../../worker/src/services/style-setup-core'
import { standardStarter } from '../../../../../worker/src/services/style-starter-definition'
import { SAMPLE_MENUS } from '../model'
import { STYLE_EXPERIENCE_SCRIPT as script } from './script'
import { FORBIDDEN_DEMO_TEXT, collectStrings } from './demo-guard.fixture'

const INDUSTRY = ['restaurant', 'salon', 'consult', 'lesson'] as const

describe('スタイル体験の見本の台本', () => {
  it('6 つのスタイルを全部持ち、札は 5 つ（標準・EC は 1 つの札で続けて流す）', () => {
    expect([...script.order].sort()).toEqual([...ACCOUNT_STYLES].sort())
    expect(Object.keys(script.styles).sort()).toEqual([...ACCOUNT_STYLES].sort())
    expect(script.tabs.map(tab => tab.styles)).toEqual([['restaurant'], ['salon'], ['consult'], ['lesson'], ['standard', 'ec']])
  })

  it('スタイルと札の名前が画面の言葉（styleTerm V01）と同じ', () => {
    for (const style of ACCOUNT_STYLES) expect(script.styles[style].label).toBe(styleTerm(style, 'V01'))
    for (const tab of script.tabs.filter(tab => tab.styles.length === 1)) expect(tab.label).toBe(styleTerm(tab.styles[0], 'V01'))
  })

  it('各スタイルは 5 段で、場面は手順と同じ順・1 段 3〜4 秒・1 周 15〜20 秒', () => {
    for (const style of ACCOUNT_STYLES) {
      const { steps, scenes, can } = script.styles[style]
      expect(can).toHaveLength(3)
      expect(steps).toHaveLength(5)
      expect(scenes.map(scene => scene.step)).toEqual(steps.map(step => step.key))
      expect(new Set(steps.map(step => step.key)).size).toBe(5)
      for (const scene of scenes) expect(scene.ms).toBeGreaterThanOrEqual(3000)
      for (const scene of scenes) expect(scene.ms).toBeLessThanOrEqual(4000)
      const total = scenes.reduce((sum, scene) => sum + scene.ms, 0)
      expect(total).toBeGreaterThanOrEqual(15000)
      expect(total).toBeLessThanOrEqual(20000)
    }
  })

  it('業種の数の帯の並びは本線の既定（STYLE_DEFAULT_METRIC_IDS）と同じ', () => {
    for (const style of INDUSTRY) {
      for (const scene of script.styles[style].scenes) expect(scene.dashboard.kpis.map(kpi => kpi.metric)).toEqual([...STYLE_DEFAULT_METRIC_IDS[style]])
    }
  })

  it('標準・EC のカードは初期セットのカード（defaultCards）にある物だけ。注文のカードは EC だけ', () => {
    for (const style of ['standard', 'ec'] as const) {
      const allowed = new Set(defaultCards(style).map(card => card.id))
      for (const scene of script.styles[style].scenes) for (const { id } of scene.dashboard.cards ?? []) expect(allowed.has(id)).toBe(true)
    }
    const ids = (style: AccountStyle) => script.styles[style].scenes.flatMap(scene => scene.dashboard.cards ?? []).map(card => card.id)
    expect(ids('standard')).not.toContain('ec-orders')
    expect(ids('ec')).toContain('ec-orders')
  })

  it('業種の画面の名前・主ボタン・タブは STYLE_CONFIG から読む（台本に写さない）', () => {
    const text = JSON.stringify(script)
    for (const style of INDUSTRY) expect(text).not.toContain(`"${STYLE_CONFIG[style].primary}"`)
  })

  it('リッチメニューは初期セットのボタン。飲食は画面の見本の 6 つ（初期セットを 6 つに増やす決定）', () => {
    expect(script.styles.restaurant.richMenu?.map(button => button.label)).toEqual(SAMPLE_MENUS.restaurant?.tiles.map(tile => tile.label))
    expect(script.styles.restaurant.richMenu).toHaveLength(6)
    for (const style of ['salon', 'consult', 'standard', 'ec'] as const) {
      const menu = standardStarter(style).items.find(item => item.kind === 'rich_menu')
      expect(script.styles[style].richMenu?.map(button => button.label)).toEqual(menu?.buttons?.map(button => button.label))
    }
    // 教室のメニューには準備中の購入の言葉が入るので、トークの下に出さない。
    expect(script.styles.lesson.richMenu).toBeUndefined()
  })

  it('初期セットから届く文（あいさつ・前日の案内・お礼）は初期セットの文と同じ', () => {
    let checked = 0
    for (const style of ACCOUNT_STYLES) {
      const items = standardStarter(style).items
      for (const scene of script.styles[style].scenes) {
        if (scene.phone.part !== 'line-talk') continue
        for (const message of scene.phone.data.messages.filter(message => message.starter)) {
          expect(items.find(item => item.key === message.starter)?.text, `${style} ${message.starter}`).toBe(message.text)
          checked++
        }
      }
      // お礼の段は、初期セットのお礼の文を出す（業種 4 つ）。
      if ((INDUSTRY as readonly string[]).includes(style)) {
        const thanks = script.styles[style].scenes.find(scene => scene.step === 'thanks')
        expect(thanks?.phone.part === 'line-talk' && thanks.phone.data.messages.some(message => message.starter === 'reminder-thanks')).toBe(true)
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('本線に無い物（別の会議の道具・月謝・ベルの知らせ・会議の URL）の言葉が無い', () => {
    const strings = collectStrings(script)
    for (const word of FORBIDDEN_DEMO_TEXT) expect(strings.filter(text => text.includes(word))).toEqual([])
  })

  it('お客さまの名前が「見本 〇〇」の作り物だけで、写真の URL を持たない', () => {
    const names: string[] = []
    const visit = (value: unknown, key = '') => {
      if (Array.isArray(value)) { value.forEach(item => visit(item)); return }
      // フォームの設計・予約メニュー・座席表の name は人の名前ではない。
      if (value && typeof value === 'object') { Object.entries(value).filter(([k]) => !['layout', 'menu', 'floor'].includes(k)).forEach(([k, v]) => visit(v, k)); return }
      if (typeof value === 'string' && ['name', 'customerName', 'display_name'].includes(key)) names.push(value)
    }
    for (const style of ACCOUNT_STYLES) visit(script.styles[style].scenes)
    const people = names
    expect(people.length).toBeGreaterThan(0)
    for (const name of people) expect(name).toMatch(/^見本 \S+$/)
    expect(collectStrings(script).filter(text => /https?:\/\//.test(text))).toEqual([])
  })
})
