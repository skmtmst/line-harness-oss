// @vitest-environment happy-dom

/*
 * R26追補: スマホ幅では動作の文章入力欄を種類の選択の下に全幅で置く。
 *
 * `flex-1` だけだと種類の選択と同行に残り、390px では約50pxに押し込まれて
 * 「ありた…」と切れていた。`basis-full` で折り返す。jsdom では幅を測れない
 * ため、折り返しを起こすクラスが付くことを描いた実物で見る。
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ActionEditor from '@/components/forms/action-editor'
import { EMPTY_REFS } from '@/components/forms/form-refs'

describe('動作の文章入力欄はスマホ幅で全幅に折り返す', () => {
  afterEach(() => {
    cleanup()
  })

  it('「テキストを送る」の文章欄が全幅の折り返しを持つ', () => {
    const view = render(
      <ActionEditor
        value={[{ kind: 'send_text', text: 'ありがとうございます' }]}
        onChange={() => {}}
        refs={EMPTY_REFS}
      />,
    )
    const input = view.getByPlaceholderText('送る文面')
    expect(input.className).toContain('basis-full')
    expect(input.className).toContain('sm:basis-auto')
  })

  it('「友だち情報に書く」の値欄が全幅の折り返しを持つ', () => {
    const view = render(
      <ActionEditor
        value={[{ kind: 'friend_field', fieldId: '', value: '123' }]}
        onChange={() => {}}
        refs={EMPTY_REFS}
      />,
    )
    const input = view.getByPlaceholderText('書き込む値')
    expect(input.className).toContain('basis-full')
    expect(input.className).toContain('sm:basis-auto')
  })

  it('入力欄を持たない種類には文章欄を出さない', () => {
    const view = render(
      <ActionEditor
        value={[{ kind: 'reminder', reminderId: '' }]}
        onChange={() => {}}
        refs={EMPTY_REFS}
      />,
    )
    expect(view.queryByPlaceholderText('送る文面')).toBeNull()
    expect(view.queryByPlaceholderText('書き込む値')).toBeNull()
    expect(view.getByText('— リマインダ —')).toBeTruthy()
  })
})
