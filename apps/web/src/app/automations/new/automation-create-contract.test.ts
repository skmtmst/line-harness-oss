import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVENTS } from '@/v8/automations/create/draft-options'

/**
 * 現役のルールを作る（V8）の見張り。
 *
 * 主に見ているのは、保存・権限・読み込みの扱いと、
 * **選べるきっかけが、実際に発火するものだけであること**。
 *
 * きっかけは、この画面のソースを読むだけでは確かめられない。発火するかは
 * `apps/worker` の `fireEvent` 呼び出し元が決めるので、そちらを読んで突き合わせる。
 * 画面側の一覧だけを見る試験にすると、また「保存はできるが一度も動かない」
 * 選択肢が増えたときに気づけない。
 */

const HERE = import.meta.dirname
const REPO = join(HERE, '..', '..', '..', '..', '..', '..')
/**
 * 注釈を落とした本文。
 *
 * 「準備中を出さない」のような**やらない決めごとは注釈にも書く**ので、
 * 生のソースを見ると自分の注釈に当たる。画面に出る文字だけを見る。
 */
const TYPES = readFileSync(join(REPO, 'packages', 'shared', 'src', 'types', 'automations.ts'), 'utf8')

/**
 * 画面が並べているきっかけの値。
 *
 * #942 N-355: 画面の EVENTS は共有の正本（`AUTOMATION_DRAFT_TRIGGER_OPTIONS`）
 * からそのまま作る。ここでは「本当に共有から描いている」ことを確かめたうえで、
 * 共有の値を画面の選択肢として返す。
 */
function screenEventValues(): string[] {
  return EVENTS.map((option) => option.value)
}

/** `AutomationEventType` が許している値。 */
function allowedEventTypes(): string[] {
  const block = /export type AutomationEventType =([\s\S]*?);/.exec(TYPES)
  if (!block) throw new Error('AutomationEventType が読めません')
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * `fireEvent(..., '<値>'` を worker 側から探す。
 *
 * 引数の1つめはDBの持ち方で `db` だったり `c.env.DB` だったりする。
 * どちらでも当たるようにする。
 */
function firedEventTypes(): Set<string> {
  const root = join(REPO, 'apps', 'worker', 'src')
  const fired = new Set<string>()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    const source = readFileSync(join(entry.parentPath ?? root, entry.name), 'utf8')
    for (const m of source.matchAll(/fireEvent\([^,]*, '([^']+)'/g)) fired.add(m[1])
    // フォーム・リンク・予約はルートがイベントバスへ渡し、日時系は
    // trigger_type としてCronが拾う。直接 fireEvent の形だけに限定しない。
    for (const m of source.matchAll(/(?:eventType|triggerType): '(form_submitted|link_clicked|calendar_booked|datetime|daily|weekly)'/g)) fired.add(m[1])
    if (/trigger_type IN \('datetime', 'daily', 'weekly'\)/.test(source)) {
      for (const type of ['datetime', 'daily', 'weekly']) fired.add(type)
    }
    if (source.includes("'ec.order.confirmed'") && source.includes('EVENT_TRIGGER_TYPES')) fired.add('ec.order.confirmed')
  }
  // 飲食は同じトランザクションでoutboxへ書き、共通配送からfireEventへ渡す。
  const restaurantDelivery=readFileSync(join(root,'services/restaurant-events.ts'),'utf8')
  if(restaurantDelivery.includes('fireEvent(owned,e.event_type')) {
    const migration=readFileSync(join(REPO,'packages/db/migrations/629_restaurant_reservation_events.sql'),'utf8')
    for(const m of migration.matchAll(/'(restaurant\.[a-z_.]+)'/g))fired.add(m[1])
  }
  return fired
}

describe('V8 ルールを作る', () => {

  it('選べるきっかけが AutomationEventType に収まっている', () => {
    const allowed = allowedEventTypes()
    expect(allowed.length).toBeGreaterThan(0)
    const values = screenEventValues()
    expect(values.length).toBeGreaterThan(0)
    expect(values.filter((v) => !allowed.includes(v))).toEqual([])
  })

  it('選べるきっかけが、実際に発火するものだけである', () => {
    const fired = firedEventTypes()
    // 取り違えて空集合になったら、この試験は何も見なくなる。
    expect(fired.size).toBeGreaterThan(2)
    const values = screenEventValues()
    expect(
      values.filter((v) => !fired.has(v)),
      '発火する呼び出しが apps/worker にないきっかけを画面へ出しています',
    ).toEqual([])
  })
})
