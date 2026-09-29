import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(here, name), 'utf8')
const PROJECTS = read('projects-section.tsx')
const LIBRARY = read('library-section.tsx')

/**
 * M022：作成・操作の失敗が原文表示のままで再試行の案内がない。
 * 原文のまま出さず、共通の状態別案内（再試行の言葉つき）へ渡す。
 * ダイアログは開いたままなので送り直しはできる。
 */
describe('M022 バナー作成・操作の失敗の再試行案内', () => {
  it('プロジェクト作成の失敗は状態別案内へ渡す', () => {
    expect(PROJECTS).toContain('describeApiFailure(')
    expect(PROJECTS).toContain('プロジェクトの作成')
    expect(PROJECTS).toContain('この操作はオーナーか管理者だけができます')
    expect(PROJECTS).not.toContain("caught.message : 'プロジェクトを作れませんでした'")
  })

  it('受け渡し・一覧から外す失敗は状態別案内へ渡す', () => {
    expect(LIBRARY).toContain('describeApiFailure(')
    expect(LIBRARY).toContain('アカウントへの受け渡し')
    expect(LIBRARY).toContain('一覧からの削除')
    expect(LIBRARY).toContain('この操作はオーナーか管理者だけができます')
    expect(LIBRARY).not.toContain("caught.message : 'アカウントへ渡せませんでした。もう一度お試しください。'")
    expect(LIBRARY).not.toContain("caught.message : '一覧から外せませんでした。もう一度お試しください。'")
  })
})
