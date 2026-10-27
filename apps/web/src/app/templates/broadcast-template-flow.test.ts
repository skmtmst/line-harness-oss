import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const broadcastsSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../broadcasts/page.tsx'), 'utf8')

/*
 * 種類のタブ（カルーセル・リッチメッセージ・クーポン・リサーチ）は templates-list-behavior.test.tsx、
 * 一斉配信の候補の読み方は components/broadcasts/broadcast-template-picker-account-react.test.tsx で、
 * 画面を開いて確かめる。ここに残すのは、一斉配信の一覧へ作る口を戻さない見張りだけ。
 */
describe('コンテンツテンプレートから一斉配信への引用導線', () => {
  it('does not keep content-authoring tabs on the broadcast list', () => {
    expect(broadcastsSource).not.toContain('一斉配信メニュー')
    expect(broadcastsSource).not.toContain('<BroadcastAssetManager')
  })
})
