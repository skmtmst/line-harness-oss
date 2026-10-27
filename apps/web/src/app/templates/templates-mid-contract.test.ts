import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const QUESTION_NEW = fs.readFileSync(
  path.join(__dirname, '../../v8/templates/question-new.tsx'),
  'utf8',
)

/*
 * 読み込めないときに保存を止める（メッセージ・カルーセル）、3つの作る画面が選んだフォルダで保存する、
 * 素材の保存の知らせと二度押しは、v8/template-edit/edit.test.tsx・carousel/page-save-retry.test.tsx・
 * question-template-react.test.tsx で、画面を開いて押して確かめる。
 */
describe('点検・中: テンプレートの画面契約', () => {
  it('中2: 質問の分類候補は置き場一覧から取り、全件取得しない', () => {
    expect(QUESTION_NEW).not.toContain('api.templates.list(')
  })
})
