import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared'

/**
 * ルールを作る（★V6 `Rv8Jv`）の見張り。
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
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
/**
 * 注釈を落とした本文。
 *
 * 「準備中を出さない」のような**やらない決めごとは注釈にも書く**ので、
 * 生のソースを見ると自分の注釈に当たる。画面に出る文字だけを見る。
 */
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const TYPES = readFileSync(join(REPO, 'packages', 'shared', 'src', 'types.ts'), 'utf8')

/**
 * 画面が並べているきっかけの値。
 *
 * #942 N-355: 画面の EVENTS は共有の正本（`AUTOMATION_DRAFT_TRIGGER_OPTIONS`）
 * からそのまま作る。ここでは「本当に共有から描いている」ことを確かめたうえで、
 * 共有の値を画面の選択肢として返す。
 */
function screenEventValues(): string[] {
  expect(PAGE, '画面が共有の選択肢から描いていない').toContain('AUTOMATION_DRAFT_TRIGGER_OPTIONS.map')
  return AUTOMATION_DRAFT_TRIGGER_OPTIONS.map((option) => option.value)
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
  return fired
}

describe('V6 ルールを作る（Rv8Jv）', () => {
  it('保存後に見込み人数を確認でき、0件と書かない', () => {
    expect(PAGE).toContain(
      '保存後に見込み人数を確認できます。',
    )
    // 見込み人数の枠に 0 を書かない。
    expect(PAGE).not.toContain('見込み人数: 0')
    expect(PAGE).not.toContain('0人が当てはまります')
  })

  it('権限が無いときは保存を押せない形にし、理由を本文へ出す', () => {
    expect(PAGE).toContain("return '操作する権限がありません'")
    expect(PAGE).toContain('操作する権限がありません。オーナーか管理者に依頼してください。')
    expect(PAGE).toContain('disabled={saving || Boolean(blockedReason)}')
    expect(PAGE).toContain('if (saving || blockedReason) return')
  })

  it('読み込み中と読み込めなかったときを言い分ける', () => {
    expect(PAGE).toContain('読み込んでいます')
    expect(PAGE).toContain('タグを読み込めませんでした。画面を再読み込みしてください。')
    // 読めていないのに空の選択肢だけを出さない。
    expect(PAGE).toContain('disabled={tagsLoading || tagsFailed}')
  })

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

  it('一度も動かない旧きっかけを戻さない', () => {
    for (const dead of ['friend_added', 'tag_added']) {
      expect(PAGE, `${dead} は発火しません`).not.toContain(`'${dead}'`)
    }
    expect(PAGE_CODE).not.toContain('準備中')
  })

  it('すること（動き）を複数持てる', () => {
    expect(PAGE).toContain('動きを追加する')
    expect(PAGE).toContain('この動きを削除する')
    // 送る形は `draftActions()` にまとめた（確認画面とのずれ検出でも同じ形を使う）。
    // 名前が変わっても「入力の並びをそのまま送る」ことは崩さない。
    expect(PAGE).toContain('const draftActions = (): AutomationDraftAction[] => actions.map(')
    expect(PAGE).toContain('actions: draftActions(),')
    // 1つしか送らない形へ戻さない。
    expect(PAGE).not.toContain('actions: [\n')
  })

  it('共有の全種類を表示し、下書き・見込み人数・1人テスト・公開へ接続する', () => {
    // #942 N-355: 下書きunionと同じ10種を全部出す（以前は6種だけ）。
    expect(screenEventValues()).toHaveLength(AUTOMATION_DRAFT_TRIGGER_OPTIONS.length)
    expect(PAGE).toContain('api.automations.createDraftFromTemplate')
    expect(PAGE).toContain('api.automations.updateDraft')
    expect(PAGE).toContain('api.automations.audiencePreview')
    expect(PAGE).toContain('api.automations.test')
    expect(PAGE).toContain('api.automations.publishDraft')
    expect(PAGE).toContain('つくって動かす')
  })

  it('同じきっかけ注意はこの店だけ見る (#580)', () => {
    expect(PAGE).toContain('api.automations.list({ accountId: selectedAccountId })')
    expect(PAGE).toContain('保存した時点の内容で試します')
  })
})
