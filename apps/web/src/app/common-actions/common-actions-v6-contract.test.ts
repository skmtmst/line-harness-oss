import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const LIST = read('page.tsx')
const CREATE = read('new', 'page.tsx')
const EDIT = read('edit', 'page.tsx')
const VERSIONS = read('versions', 'page.tsx')
const EDITOR = read('..', '..', 'components', 'automations', 'common-action-editor.tsx')
const PERMISSION = read('..', '..', 'components', 'automations', 'use-common-action-permission.ts')
const API = read('..', '..', 'lib', 'api.ts')
const WORKER = read('..', '..', '..', '..', 'worker', 'src', 'services', 'common-actions.ts')
const ENGINE = read('..', '..', '..', '..', 'worker', 'src', 'services', 'automation-engine.ts')
const FOUNDATION = read('..', '..', '..', '..', '..', 'packages', 'db', 'migrations', '181_automation_v6_foundation.sql')

describe('V6共通アクションの画面契約', () => {
  it('Pencilの3画面を実ノードIDへ結び付ける', () => {
    expect(LIST).toContain('data-design-node="xOpDs"')
    expect(CREATE).toContain('data-design-node="py5CG"')
    expect(EDIT).toContain('data-design-node="py5CG"')
    expect(VERSIONS).toContain('data-design-node="syWp4"')
  })

  it('一覧・空・読込・失敗と、名前で分かる遷移を持つ', () => {
    expect(LIST).toContain('共通アクションを読み込んでいます')
    expect(LIST).toContain('共通アクションはまだありません')
    expect(LIST).toContain('共通アクションを読み込めませんでした')
    expect(LIST).toContain('中身を見る')
    expect(LIST).toContain('複製して下書きを作る')
    expect(LIST).toContain('/common-actions/versions?id=')
    expect(LIST).not.toContain('準備中')
  })

  it('作成はJSON入力ではなく、選択肢と順番で編集する', () => {
    expect(CREATE + EDIT).toContain('<CommonActionEditor')
    expect(EDITOR).toContain('失敗したとき')
    expect(EDITOR).toContain('処理を追加')
    expect(EDITOR).not.toContain('actionsJson')
    expect(CREATE).not.toContain('<main className=')
  })

  it('利用版の変更前に差分と進行中への影響を確認する', () => {
    expect(VERSIONS).toContain('変更内容を確認')
    expect(VERSIONS).toContain('現在の版')
    expect(VERSIONS).toContain('更新後')
    expect(VERSIONS).toContain('実行中・待機中の処理は変えず')
    expect(VERSIONS).toContain('<Dialog')
  })

  it('閲覧権限と編集権限を画面でも分ける', () => {
    expect(PERMISSION).toContain("role === 'owner' || role === 'admin'")
    expect(CREATE + EDIT).toContain('共通アクションは閲覧のみです')
    expect(LIST + VERSIONS).toContain('canManage')
  })

  it('ヘッダーの最後をマニュアルにする', () => {
    expect(LIST.indexOf('マニュアル')).toBeGreaterThan(LIST.indexOf('共通アクションをつくる'))
    expect(VERSIONS.indexOf('マニュアル')).toBeGreaterThan(VERSIONS.indexOf('前の版から新版を作る'))
  })
})

describe('V6共通アクションの機能契約', () => {
  it('画面操作を読み書きAPIへ接続する', () => {
    for (const method of ['resources:', 'list:', 'get:', 'create:', 'duplicate:', 'updateDraft:', 'createDraft:', 'publish:', 'updateBinding:']) {
      expect(API).toContain(method)
    }
  })

  it('公開版を直接変更せず、実行開始時の計画へ展開する', () => {
    expect(FOUNDATION).toContain('trg_common_action_published_version_immutable')
    expect(WORKER).toContain('common_action_cycle')
    expect(ENGINE).toContain('buildExecutionPlan')
    expect(ENGINE).toContain('execution_plan_json')
    expect(ENGINE).toContain('common_action_marker')
  })
})
