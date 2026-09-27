import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(__dirname, './tags-page-v4.tsx'), 'utf8')

/*
 * R165: 390pxではフォルダを作れても名前変更・色・削除の入口が無かった。
 * 操作のある帯が1280px未満で非表示で、開く口も無かった。
 * happy-dom には幅の概念が無いため、導線の構図（開閉できる帯で同じ
 * 管理操作を出す・操作ボタンが狭い幅で隠れない）を源泉で固定する。
 * 実機の幅確認（390pxで作成・名前変更・色変更・削除へ到達）は撮影
 * （司令塔）で行う。
 */
describe('R165 スマホのフォルダ管理導線', () => {
  it('1280px未満にフォルダ管理の開閉できる帯を出す', () => {
    expect(page).toContain('<div className="xl:hidden">')
    expect(page).toContain('title="フォルダを管理"')
    // PC と同じ操作（名前変更・色・削除・並び順）を使い回す。
    expect(page).toContain('<FolderList groups={groups} items={items} countsKnown={ready} active={folder} onSelect={setFolder} onChanged={() => void load()} />')
  })

  it('狭い幅ではフォルダの操作ボタンを隠さない', () => {
    // hover の無い画面でも「…」が見える。PC の hover 表示は残す。
    expect(page).toContain('invisible group-hover:visible focus-visible:visible max-xl:visible')
  })
})
