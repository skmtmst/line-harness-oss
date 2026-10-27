import nodeFs from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
const fs = { ...nodeFs, readFileSync: readUiSource }
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { describeAfterSend, describeStepAudience } from './scenario-step-audience'

/*
 * 機能5（シナリオ配信）を設計へ寄せたぶんの契約。
 *
 * 画面の動き（保存・開始・配信の段、通ごとの数、通の行の操作と編集欄、開始条件の一致人数、
 * テスト送信の窓）は、画面を描いて押す試験が守る：
 *   v8/scenario-detail/detail-actions.test.tsx・detail.test.tsx、
 *   app/scenarios/detail/scenario-simulation-refresh-react.test.tsx（試算の取り直し）、
 *   components/scenarios/trigger-editor-match.test.tsx・test-send-dialog-pick.test.tsx。
 * ここに残すのは、戻してはいけない語・書き方の見張りと、言い表し方の関数の確かめだけ。
 *
 * **ファイル全体を `toContain` で見ない。** 見出しから外した語が、外した
 * 理由を書いた注釈の中に残っていて、既存の試験が素通りした例がある。
 * ここでは
 *   1. 注釈（`//` と `/* *​/` と `{/* *​/}`）を先に落とし、
 *   2. 見たい関数・見たいJSXの範囲だけを切り出してから
 * 見る。
 */

const DETAIL = path.join(__dirname, 'scenario-detail-client.tsx')
const SCENARIOS = path.join(__dirname, '..', '..', '..', 'components', 'scenarios')

/** 注釈を落とす。落とさないと「外した理由」の文が本文として数えられる。 */
export function withoutComments(source: string): string {
  return (
    source
      // 塊の注釈を先に落とす。JSXの `{/* … */}` は中身が消えて `{ }` だけ残るが、
      // 画面には何も出ないので切り出しの邪魔にならない。
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // 行の注釈。`https://` のスラッシュ2つを注釈と間違えないよう、
      // 直前が `:` か `/` のものは残す。
      .replace(/(^|[^:/])\/\/.*$/gm, '$1')
  )
}

/** `start` から、対応する終わりまでを切り出す。見つからなければ失敗する。 */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`切り出しの始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`切り出しの終わりが見つかりません: ${end}`)
  return source.slice(from, to + end.length)
}

const detail = withoutComments(fs.readFileSync(DETAIL, 'utf8'))
const triggerEditor = withoutComments(
  fs.readFileSync(path.join(SCENARIOS, 'trigger-editor.tsx'), 'utf8'),
)
const dialogs = withoutComments(
  fs.readFileSync(path.join(SCENARIOS, 'scenario-dialogs.tsx'), 'utf8'),
)

/** 見出しの `<Header ... />` だけ。説明文はここに書かれる。 */
const header = slice(detail, '<PageHeading', '</>} />')
/** 設計どおりの警告帯だけ。 */
const banner = slice(detail, '<div className={styles.stageCards}>', '<KpiBand')
/** コンテンツ表の見出し行だけ。 */
const thead = slice(detail, '<section className={styles.statPanel}>', '</section>')
/** 通の編集フォームだけ。 */
const stepForm = slice(detail, 'export function ScenarioStepForm(', '\n}\n')
/** 開始条件の面の、人数の段だけ。 */
const matchBlock = slice(triggerEditor, '現在の条件に一致する友だち', '</dl>')
/** テスト送信の窓の本文だけ。 */
const testSendBody = slice(dialogs, 'export function TestSendDialog(', '\n}\n')

describe('注釈を落としてから見る', () => {
  it('注釈の中の語を本文として数えない', () => {
    const source = [
      '{/* 見出しから外した理由：作成しただけでは配信されません */}',
      '// 作成しただけでは配信されません',
      '/* 作成しただけでは配信されません */',
      '<p>ここは本文</p>',
    ].join('\n')
    expect(withoutComments(source)).not.toContain('作成しただけでは配信されません')
    expect(withoutComments(source)).toContain('ここは本文')
  })

  it('URLのスラッシュ2つを注釈と間違えない', () => {
    expect(withoutComments("href='https://example.com/a'")).toContain('https://example.com/a')
  })
})

describe('配信対象の言い表し方', () => {
  const tags = [{ id: 't1', name: '初回案内' }]

  it('絞り込みが無い通は「購読中の全員」。—にしない', () => {
    expect(describeStepAudience(null, tags)).toBe('購読中の全員')
    expect(describeStepAudience({ operator: 'AND', rules: [] }, tags)).toBe('購読中の全員')
  })

  it('タグ1つならタグの名前で言う', () => {
    expect(
      describeStepAudience({ operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] }, tags),
    ).toBe('タグ：初回案内')
  })

  it('名前が引けないタグは件数で言う。内部IDを画面に出さない', () => {
    const label = describeStepAudience(
      { operator: 'AND', rules: [{ type: 'tag_exists', value: 'deleted-tag-id' }] },
      tags,
    )
    expect(label).not.toContain('deleted-tag-id')
    expect(label).toBe('詳細条件 1件')
  })

  it('書きかけの行は数えない', () => {
    expect(
      describeStepAudience(
        {
          operator: 'AND',
          rules: [
            { type: 'tag_exists', value: 't1' },
            { type: 'tag_exists', value: '' },
          ],
        },
        tags,
      ),
    ).toBe('タグ：初回案内')
  })

  it('or条件のかたまりも数に入れる', () => {
    expect(
      describeStepAudience(
        {
          operator: 'AND',
          rules: [
            { type: 'private_memo', value: 'あ' },
            { type: 'status_message', value: 'い' },
          ],
          groups: [{ operator: 'OR', rules: [{ type: 'tag_exists', value: 't1' }] }],
        },
        tags,
      ),
    ).toBe('詳細条件 2件 ＋ or条件 1組')
  })

  it('送ったあと次へ進むのは決まっている値。—にしない', () => {
    expect(describeAfterSend('continue')).toEqual({ label: '次へ進む', paused: false })
    expect(describeAfterSend(undefined)).toEqual({ label: '次へ進む', paused: false })
    /*
     * R236: pause は人が再開するまで止まるだけ。返信で自動再開しないのに
     * 「返信まで」と書くと、返信を待てば続くと誤解される。編集欄の
     * 「送信後：ここで止める」と同じ意味の文言にそろえる。
     */
    expect(describeAfterSend('pause')).toEqual({ label: '送信後に一時停止', paused: true })
  })
})

describe('bV5Vs シナリオ編集', () => {
  it('SCENARIO-23: 操作名は単語の途中で折らず、操作列の必要幅を確保する', () => {
    // 見た目の値。画面の崩れの見張り（v8-screen-guard）と照らすまでは残す。
    const css = fs.readFileSync(path.join(__dirname, '../../../v8/scenario-detail/detail.module.css'), 'utf8')
    expect(css).toMatch(/\.stepOps\s*\{[^}]*flex-shrink: 0;/)
  })
})

describe('戻してはいけない語・書き方', () => {
  it('見出しに「作成しただけでは配信されません」を戻さない', () => {
    expect(header).not.toContain('作成しただけでは配信されません')
  })

  it('通一覧に固定の最小幅を戻さない（#949 N-058）', () => {
    const steps = slice(detail, '<ol className={styles.stepList}>', '</ol>')
    expect(steps).not.toMatch(/min-w-\[\d+px\]/)
  })

  it('取れない配信前チェックに「送信枠を超えていません」を作らない', () => {
    const summary = slice(stepForm, '<h4 className="text-ink text-sm font-bold">設定内容</h4>', '</dl>')
    expect(summary).not.toContain('送信枠を超えていません')
  })

  it('開始条件の予約中の人数を引き算で作らず、古い読込中の言葉と単位付きの「—」を戻さない', () => {
    const planned = slice(matchBlock, '<dt className="text-ink-faint text-xs">予約中</dt>', '</dd>')
    expect(planned).not.toMatch(/activeNow|match\.matched\s*-/)
    expect(triggerEditor).not.toContain('読み込み中…')
    expect(matchBlock).not.toContain('—人')
  })
})

/**
 * JSXの**素の文**だけを取り出す。
 *
 * `className` や `title={... ? undefined : ...}` は画面に出ない。ソースを
 * そのまま `toContain` で見ると、コードの `undefined` を「画面に出た」と
 * 読み違える。`>` と `<` に挟まれ、波かっこを含まない部分だけを見る。
 */
function textNodes(jsx: string): string[] {
  return [...jsx.matchAll(/>([^<>{}]+)</g)]
    .map((m) => m[1].trim())
    .filter((t) => t !== '')
}

describe('画面に出してはいけない語', () => {
  it('素の文の抜き出しが、classNameやコードを拾わない', () => {
    const sample = '<p className="a-b" title={x ?? undefined}>ほんぶん</p>'
    expect(textNodes(sample)).toEqual(['ほんぶん'])
  })

  it('内部ID・undefined・NaN・Invalid Date を出さない', () => {
    const shown = [banner, thead, matchBlock, testSendBody].flatMap(textNodes).join('\n')
    for (const word of ['undefined', 'NaN', 'Invalid Date', '[object Object]']) {
      expect(shown, `${word} が画面の文言に出ています`).not.toContain(word)
    }
  })

  it('壊れた値を渡しても、壊れた語を返さない', () => {
    for (const broken of [undefined, null, 0, 'x', { rules: 'x' }, { operator: 'AND' }]) {
      const label = describeStepAudience(broken, [{ id: 't1', name: 'a' }])
      expect(label).not.toMatch(/undefined|NaN|\[object Object\]/)
    }
  })
})
