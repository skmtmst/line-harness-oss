import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(
  path.join(__dirname, 'scenario-detail-client.tsx'),
  'utf8',
)

describe('V6 シナリオ編集の契約', () => {
  it('上部の一括テスト送信を既存の全通テスト送信へ接続する', () => {
    expect(PAGE).toContain(
      "onClick={() => setTestSend({ stepId: null, label: 'このシナリオの全通' })}",
    )
    expect(PAGE).not.toContain('一括テスト送信は準備中です')
  })

  it('一括テスト送信の操作を画面内に重複させない', () => {
    expect(PAGE.match(/>\s*一括テスト送信\s*<\/button>/g)).toHaveLength(1)
  })
})
