import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(path.join(__dirname, 'page.tsx'), 'utf8')
/* 止める窓は 管理画面 共用の v8/conversions/list.tsx・dialogs.tsx にある。 */
const DIALOGS = fs.readFileSync(path.join(__dirname, '../../v8/conversions', 'dialogs.tsx'), 'utf8')

/** 注意書きの中の `confirm(` に当てないため、コメントを外す。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 成果地点の削除確認の禁止の見張り。止める・差し替える・削除するの窓、二度押し、返事の確かめ、
 * 失敗の言葉、押せる状態へ戻すことは v8/conversions/list.test.tsx が描画して確かめる。
 */
describe('成果地点の削除確認', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(PAGE), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(code(DIALOGS), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
  })

  it('生のAPIエラーをそのまま出さない', () => {
    expect(code(PAGE), '生のAPIエラーをそのまま出している').not.toContain('setStopError(res.error)')
  })
})
