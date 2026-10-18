import nodeFs from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
const fs = { ...nodeFs, readFileSync: readUiSource }
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { describeAfterSend, describeStepAudience } from './scenario-step-audience'

/*
 * 機能5（シナリオ配信）を設計へ寄せたぶんの契約。
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

/** `start` から、対応する終わりまでを切り出す。 */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `切り出しの始まりが見つかりません: ${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `切り出しの終わりが見つかりません: ${end}`).toBeGreaterThan(-1)
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

describe('bV5Vs シナリオ編集', () => {
  it('V8の保存の段で、保存だけでは届かないことと開始操作を区別する', () => {
    expect(header).not.toContain('作成しただけでは配信されません')
    expect(banner).toContain('保存しただけでは誰にも届きません')
    expect(banner).toContain('setStartOpen(true)')

  })

  it('V8の開始の段から条件設定を開く', () => {
    expect(banner).toContain('開始のきっかけ')
    expect(banner).toContain('onClick={() => setTriggerOpen(true)}')
    expect(banner).toContain('設定を変える')

  })

  it('V8の通ごとの数は対象条件と到達率の実値を使う', () => {
    expect(thead).toContain('describeStepAudience(step.targetCondition, tags)')
    expect(thead).toContain('scenarioReachPercent(stat?.reachRate)')

  })

  it('配信後の桁に、決まっている値を「—」で出さない', () => {
    expect(thead).toContain('const after = describeAfterSend(step.afterSend)')
    expect(thead).toContain('after.label')

  })

  it('開始のきっかけの札から、設計どおり開始条件の面を開ける', () => {
    expect(banner).toContain('onClick={() => setTriggerOpen(true)}')
    expect(detail).toContain('onSelect: () => setAudienceOpen(true)')

  })

  it('通一覧は固定の最小幅を持たない（#949 N-058）', () => {
    const steps = slice(detail, '<ol className={styles.stepList}>', '</ol>')
    expect(steps).not.toMatch(/min-w-\[\d+px\]/)
    expect(steps).toContain('<RowMenu')
    for (const id of ['preview', 'test', 'action', 'duplicate', 'delete']) {
      expect(steps).toContain(`id: '${id}'`)
    }

  })

  it('SCENARIO-23: 操作名は単語の途中で折らず、操作列の必要幅を確保する', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../../v8/scenario-detail/detail.module.css'), 'utf8')
    expect(css).toMatch(/\.stepOps\s*\{[^}]*flex-shrink: 0;/)
    expect(detail).toContain('<RowMenu')
    expect(detail).toContain('className={styles.stepOps}')

  })
})

describe('SCENARIO-15 開始前試算の取り直し', () => {
  it('試算の取得は保存済み設定の鍵を見て動き直す', () => {
    /*
     * 以前は id と lineAccountId だけを見ていたため、対象条件・通・時刻を
     * 保存して loadScenario(true) しても試算を取り直さなかった。
     * 鍵（scenarioSimulationKey）を依存に入れて、設定が変われば取り直す。
     */
    expect(detail).toContain('scenarioSimulationKey(scenario, triggerCount === null || triggerRevision === 0 ? triggerCount : `${triggerCount}:${triggerRevision}`)')
    const effect = slice(detail, 'const key = simulationKey', 'setRuns(runsResponse?.success ? runsResponse.data : null)')
    expect(effect).toContain('api.scenarios.simulate(id, lineAccountId)')
  })

  it('遅れて届いた旧世代の応答は捨て、旧鍵の値は確定値として出さない', () => {
    const effect = slice(detail, 'const key = simulationKey', 'setRuns(runsResponse?.success ? runsResponse.data : null)')
    // 世代の掃除: 依存が変わると cancelled が立ち、旧応答は書き込まない。
    expect(effect).toContain('if (cancelled) return')
    // 表示は「今の設定の鍵に合う結果」だけ。
    expect(detail).toContain('simulationForKey(simulationResult, simulationKey)')
    expect(detail).toContain('simulationResult?.key !== simulationKey')
  })

  it('取り直し中は旧人数を確定値として出さず、開始前の確認は試算中とする', () => {
    expect(detail).toContain('simulationForKey(simulationResult, simulationKey)')
    expect(detail).toContain('simulationResult?.key !== simulationKey')
    expect(detail).toContain('value={simulation?.audience.newStartPlanned}')
    expect(detail).toContain('preflightLoading')
    expect(detail).toContain('対象：試算中…')

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

describe('通の編集を設計の段へ分ける', () => {
  it('V8の通の編集を該当行の下で開き、閉じる操作を持つ', () => {
    expect(detail).toContain('editingStepId === step.id && <li className={styles.stepEdit}>{renderStepForm()}</li>')
    expect(detail).toContain('closeStepForm()')
    expect(stepForm).toContain('node="xfYLn"')

  })

  it('配信対象の段は、条件の中身を1行で出す', () => {
    const audience = slice(stepForm, 'node="r6Gzsu"', '</FormSection>')
    expect(audience).toContain('describeStepAudience(stepForm.targetCondition, tags)')
    expect(audience).toContain('条件を編集')
  })

  it('取れない配信前チェックに、数も印も作らない', () => {
    const summary = slice(stepForm, '<h4 className="text-ink text-sm font-bold">設定内容</h4>', '</dl>')
    expect(summary).toContain('配信前チェック')
    expect(summary).toContain("emptyValue('unknown')")
    expect(summary).not.toContain('送信枠を超えていません')
    expect(stepForm).toContain(
      '配信前チェックはまだ繋がっていません。残りの送信枠とテスト送信の記録を返す取得口が接続されると表示されます。',
    )
  })
})

describe('EvVO5 開始条件', () => {
  it('設計の6種を並べ、口の無い4種は押せない形にする', () => {
    const kinds = slice(triggerEditor, 'ready: boolean }[] = [', ']\n')
    expect(kinds.match(/label:/g)).toHaveLength(6)
    expect(kinds.match(/ready: false/g)).toHaveLength(4)
    expect(kinds).toContain("label: 'フォーム回答', ready: false")
    expect(triggerEditor).toContain(
      'フォーム回答・予約確定・手動開始・API・Webhook をきっかけにする口は、まだ繋がっていません。繋がると、ここから足せるようになります。',
    )
  })

  it('押す前に一致人数を出す。購読の重なりも分かる試算APIを使う', () => {
    expect(triggerEditor).toContain('await api.scenarios.simulate(scenarioId, lineAccountId)')
    expect(matchBlock).toContain('一致')
    expect(matchBlock).toContain('すでに購読中')
    expect(matchBlock).toContain('予約中')
    expect(matchBlock).toContain('対象を再計算')
  })

  it('予約中の人数を引き算で作らない', () => {
    const planned = slice(matchBlock, '<dt className="text-ink-faint text-xs">予約中</dt>', '</dd>')
    expect(planned).toContain('match.newStartPlanned')
    expect(planned).not.toMatch(/activeNow|match\.matched\s*-/)
    expect(triggerEditor).toContain('試算では配信も購読も始まりません。')
  })

  it('読込中・取得失敗の言葉を決まりどおりにそろえる', () => {
    expect(matchBlock).toContain('読み込んでいます')
    expect(matchBlock).toContain('読み込めませんでした')
    expect(triggerEditor).toContain('再読み込み')
    expect(triggerEditor).not.toContain('読み込み中…')
  })

  it('取れない値に単位を付けない', () => {
    expect(matchBlock).not.toContain('—人')
  })
})

describe('g2UNV 一括でテストを送る', () => {
  it('本番へ何が起きないのかを断る', () => {
    expect(testSendBody).toContain('本番の登録は増えません。配信予定も作りません。')
  })

  it('送る前に、送る通を1通ずつ並べる', () => {
    expect(testSendBody).toContain('送る内容')
    expect(testSendBody).toContain('{row.stepOrder}通目')
    expect(testSendBody).toContain('{row.timing}')
  })

  it('1通ごとの結果は作らず、繋がっていないことを書く', () => {
    expect(testSendBody).toContain(
      '1通ずつの結果はまだ繋がっていません。1通ごとの送信結果を返す取得口が接続されると表示されます。',
    )
  })

  it('送り先を選ぶまで送れない', () => {
    expect(testSendBody).toContain('disabled={!selected || sending}')
  })

  it('送り先を選んだあと、誰へ何通送るかを確認してから実送信する', () => {
    expect(testSendBody).toContain('const [confirming, setConfirming] = useState(false)')
    expect(testSendBody).toContain('内容を確認')
    expect(testSendBody).toContain('selectedFriend?.displayName')
    expect(testSendBody).toContain('テストを送る')
  })

  it('詳細画面から、送る通を渡す', () => {
    const call = slice(detail, '<TestSendDialog', '/>')
    expect(call).toContain('steps={')
    expect(call).toContain('formatScheduleLabel(deliveryMode, row)')
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
