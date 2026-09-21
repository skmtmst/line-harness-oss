import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeSavedCondition } from '@/components/friends/saved-search-utils'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/*
 * IDEA-04（issue #1022）：友だち属性の分類説明・重複候補・変更前後条件。
 *
 * 実施範囲：
 *  - 既存の属性作成／編集で、タグ・情報欄・対応マーク等の違いを説明する
 *  - 重複候補と利用先を示す
 *  - 設定変更で対象人数が変わる場合、変更前後の条件・計算時点を表示する
 *  - 大量対象の影響計算が間に合わないときは「未計算」、推定は確定値にしない
 *  - 属性辞書の独立メニュー・自動統合・新しいタイトルバーは作らない
 */
describe('IDEA-04（issue #1022）友だち属性の分類説明・重複候補・変更前後条件', () => {
  it('分類の使い分け案内は共通部品1つに寄せ、4分類すべてを説明する', () => {
    const guide = read('components/friend-fields/attribute-kind-guide.tsx')
    // 4分類とも「何を持つか」「いつ選ぶか」「作る入口」を持つ。
    for (const label of ['タグ', '友だち情報欄', '対応マーク', '保存した検索']) {
      expect(guide, `分類「${label}」の説明が無い`).toContain(`label: '${label}'`)
    }
    // 作る入口は既存画面だけ。独立した属性辞書メニューは作らない。
    expect(guide).toContain("createHref: '/tags/new'")
    expect(guide).toContain("createHref: '/tags/fields/new'")
    expect(guide).toContain("createHref: '/tags/marks/new'")
    expect(guide).toContain("createHref: '/friends'")
    // 新しいタイトルバーではなく、既存カード内の開閉案内として置く。
    expect(guide).toContain('<details')
    expect(guide).toContain('いま選択中')
    expect(guide).toContain('この画面')
    // 重複名の比べ方はサーバーの duplicate_name（packages/db の
    // normalizeTagNameForCleanup）と同じ正規化。
    expect(guide).toContain("name.normalize('NFKC').trim().replace(/\\s+/g, ' ').toLocaleLowerCase('ja-JP')")
    expect(guide).toContain('findDuplicateNames')
    expect(guide).toContain('DuplicateNameNote')
  })

  it('4つの作成・編集画面すべてに分類案内と重複名の注意がある', () => {
    const cases: Array<{ file: string; kind: string; label: string }> = [
      { file: 'components/friend-fields/tag-editor-v4.tsx', kind: 'tag', label: 'タグ' },
      { file: 'app/tags/fields/new/page.tsx', kind: 'field', label: '項目' },
      { file: 'app/tags/fields/edit/page.tsx', kind: 'field', label: '項目' },
      { file: 'components/friend-fields/support-mark-editor.tsx', kind: 'mark', label: '対応マーク' },
      { file: 'app/tags/searches/edit/page.tsx', kind: 'search', label: '保存した検索' },
    ]
    for (const { file, kind, label } of cases) {
      const source = read(file)
      expect(source, `${file} に分類案内が無い`).toContain(`<AttributeKindGuide current="${kind}" />`)
      expect(source, `${file} に重複名の注意が無い`).toContain('DuplicateNameNote')
      expect(source, `${file} の重複名判定が自分自身を外していない`).toContain('findDuplicateNames')
      expect(source, `${file} の重複名の呼び名`).toContain(`kindLabel="${label}"`)
    }
  })

  it('タグ一覧は重複名の整理候補を行ごとに示す', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // サーバーの cleanupReasons だけを見る。画面で再判定しない。
    expect(source).toContain("tag.cleanupReasons?.includes('duplicate_name')")
    expect(source).toContain('重複名')
    // PC表とモバイルカードの両方に出す。
    expect(source.match(/重複名/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('タグ編集はHQ埋め込みではストアの一覧を読まず、同名だけを注意する', () => {
    const source = read('components/friend-fields/tag-editor-v4.tsx')
    // embedded（HQ定義エディタ）ではストアのタグ一覧を読まない。
    expect(source).toContain('if (embedded || !accountId) return')
    // 保存を止めない注意。サーバーの一意制約が最終判断。
    expect(read('components/friend-fields/attribute-kind-guide.tsx')).toContain('一覧の重複名の整理候補')
  })

  it('保存した検索の編集は計算時点と変更前後の条件を出す', () => {
    const source = read('app/tags/searches/edit/page.tsx')
    // 計算時点。APIの calculatedAt をそのまま出し、取れないときは出さない。
    expect(source).toContain('preview?.calculatedAt')
    expect(source).toContain('に計算')
    // 条件を変えたあとは「変更前の条件の人数」と「変更後は未計算」を分ける。
    expect(source).toContain('変更後の条件は未計算')
    expect(source).toContain('変更前：')
    expect(source).toContain('変更後：')
    // 変更前後は一覧と同じ言葉（describeSavedCondition 経由）で出す。
    expect(source).toContain('savedSearchSummary(original.conditions')
    expect(source).toContain('savedSearchSummary(conditions')
    // 未計算を推定で埋めない。人数は previewCount が無ければ —。
    expect(source).toContain("previewCount === null ? '—'")
  })

  it('条件の言語化は編集画面が作れる演算子をすべて正しく説明する', () => {
    // IDEA-04: 変更前後の条件をそのまま読める形で出すには、
    // 編集画面が作れる10演算子の呼び分けが要る。
    expect(describeSavedCondition({ kind: 'field', key: 'age', op: 'gte', value: '20' }, [], { fields: { age: '年齢' } }))
      .toBe('年齢 が次以上「20」')
    expect(describeSavedCondition({ kind: 'field', key: 'age', op: 'lt', value: '65' }, [], { fields: { age: '年齢' } }))
      .toBe('年齢 がより小さい「65」')
    expect(describeSavedCondition({ kind: 'field', key: 'pet', op: 'contains', value: '犬' }, [], { fields: { pet: 'ペット' } }))
      .toBe('ペット が次を含む「犬」')
    expect(describeSavedCondition({ kind: 'field', key: 'pet', op: 'exists' }, [], { fields: { pet: 'ペット' } }))
      .toBe('ペット が登録あり')
    expect(describeSavedCondition({ kind: 'field', key: 'pet', op: 'not_exists' }, [], { fields: { pet: 'ペット' } }))
      .toBe('ペット が未登録')
    // 旧形式の互換名（has/not_has/equals/not_equals）も誤った極性で出さない。
    expect(describeSavedCondition({ kind: 'tag', op: 'not_has', value: 't1' }))
      .toBe('タグ を含まない「選択済みのタグ」')
    expect(describeSavedCondition({ kind: 'tag', op: 'has', value: 't1' }))
      .toBe('タグ を含む「選択済みのタグ」')
    expect(describeSavedCondition({ kind: 'field', key: 'f', op: 'not_equals', value: 'x' }))
      .toBe('選択済みの友だち情報 が次と異なる「x」')
    // 名前・ステータスメッセージの完全一致は「が」、含むは「に」。
    expect(describeSavedCondition({ kind: 'name', op: 'eq', value: '田中' })).toBe('名前が「田中」')
    expect(describeSavedCondition({ kind: 'status_message', op: 'contains', value: '連絡' }))
      .toBe('ステータスメッセージに「連絡」を含む')
    // 存在確認の否定形は「無い」。「ある」で出すと逆の意味になる。
    expect(describeSavedCondition({ kind: 'event_booking', op: 'not_exists' })).toBe('イベント予約がない')
    expect(describeSavedCondition({ kind: 'memo', op: 'not_exists' })).toBe('個別メモがない')
    expect(describeSavedCondition({ kind: 'memo', op: 'eq', value: '要対応' })).toBe('個別メモが「要対応」')
    expect(describeSavedCondition({ kind: 'assignee', op: 'ne', value: 's1' }))
      .toBe('担当者が「選択済みの担当者」以外')
  })

  it('新しいタイトルバーや属性辞書メニューは増えていない', () => {
    // ガイドは共通部品 shared/ ではなく属性エリア内に置く。
    const guide = read('components/friend-fields/attribute-kind-guide.tsx')
    expect(guide).not.toContain('PageHeader')
    for (const file of [
      'components/friend-fields/tag-editor-v4.tsx',
      'app/tags/fields/new/page.tsx',
      'app/tags/fields/edit/page.tsx',
      'components/friend-fields/support-mark-editor.tsx',
      'app/tags/searches/edit/page.tsx',
      'components/friend-fields/attribute-kind-guide.tsx',
      'components/friend-fields/tags-page-v4.tsx',
    ]) {
      expect(read(file), `${file} に禁止語`).not.toContain('準備中')
    }
  })
})
