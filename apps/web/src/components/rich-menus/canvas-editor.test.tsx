// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CanvasEditor, areaDisplayName, type Area } from './canvas-editor'

/*
 * R233: リッチメニューのエリアは画像の上をマウスで掴むだけでは選べず、
 * キーボードだけの操作では触れなかった。エリア自身をTabでたどれる
 * ボタンにし、動きの名前つきの「エリア一覧」を画像の下に置く（要件19-64）。
 */

const AREAS: Area[] = [
  {
    id: 'a-1', boundsX: 0, boundsY: 0, boundsWidth: 400, boundsHeight: 200,
    actionType: 'uri', actionData: { uri: 'https://example.com' },
    intent: 'url', label: '予約サイトへ', tagIds: [], scoreChange: null,
  },
  {
    id: 'a-2', boundsX: 420, boundsY: 0, boundsWidth: 400, boundsHeight: 200,
    actionType: 'message', actionData: { text: '問い合わせ' },
    intent: 'text', label: '', tagIds: [], scoreChange: null,
  },
]

function Harness({ preview = false }: { preview?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<string[]>([])
  const [moved, setMoved] = useState<Array<Partial<Area> & { id: string }>>([])
  return (
    <>
      <div data-testid="selected">{selected ?? 'none'}</div>
      <div data-testid="deleted">{deleted.join(',')}</div>
      <div data-testid="moved">{JSON.stringify(moved)}</div>
      <CanvasEditor
        areas={AREAS}
        size="large"
        imageUrl={null}
        selectedAreaId={selected}
        onSelectArea={setSelected}
        onAddArea={() => {}}
        onUpdateArea={(id, patch) => setMoved((cur) => [...cur, { id, ...patch }])}
        onDeleteArea={(id) => setDeleted((cur) => [...cur, id])}
        preview={preview}
      />
    </>
  )
}

afterEach(() => {
  cleanup()
})

describe('エリアのキーボード操作 (R233)', () => {
  test('画像上のエリアはTabでたどれるボタンで、動きの名前が読み上げられる', () => {
    render(<Harness />)
    const areaButtons = screen.getAllByRole('button', { name: /動きは/ })
    expect(areaButtons).toHaveLength(2)
    expect(areaButtons[0].getAttribute('tabindex')).toBe('0')
    expect(areaButtons[0].getAttribute('aria-label')).toBe('予約サイトへ、動きはURLを開く')
    // 未命名のボタンは通し番号の名前になる
    expect(areaButtons[1].getAttribute('aria-label')).toBe('2番目のボタン、動きはメッセージを送る')
  })

  test('エリアにfocusすると選択になり、選択状態は読み上げに伝わる', () => {
    render(<Harness />)
    const [first] = screen.getAllByRole('button', { name: /動きは/ })
    fireEvent.focus(first)
    expect(screen.getByTestId('selected').textContent).toBe('a-1')
    expect(first.getAttribute('aria-pressed')).toBe('true')
  })

  test('エリア上でEnter・Spaceを押しても選べる', () => {
    render(<Harness />)
    const [, second] = screen.getAllByRole('button', { name: /動きは/ })
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(screen.getByTestId('selected').textContent).toBe('a-2')
    fireEvent.keyDown(second, { key: ' ' })
    expect(screen.getByTestId('selected').textContent).toBe('a-2')
  })

  test('エリア一覧は動きつきで並び、一覧からも選べる', () => {
    render(<Harness />)
    expect(screen.getByText('エリア一覧')).toBeTruthy()

    // 動きが行に添えられている（要件19-64「それぞれの動き」）
    fireEvent.click(screen.getByRole('button', { name: /2番目のボタン.*動き: メッセージを送る/ }))
    expect(screen.getByTestId('selected').textContent).toBe('a-2')
    expect(
      screen.getByRole('button', { name: /2番目のボタン.*動き: メッセージを送る/ })
        .getAttribute('aria-current'),
    ).toBe('true')
  })

  test('一覧から選んだあと、矢印キーでエリアを動かせる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /予約サイトへ.*動き: URLを開く/ }))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    // a-1 は x=0 なので左には動けず、呼ばれても値は変わらない。右なら+1。
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('moved').textContent).toContain('"id":"a-1"')
    expect(screen.getByTestId('moved').textContent).toContain('"boundsX":1')
  })

  test('一覧の「消す」でそのエリアだけ消せる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '予約サイトへを消す' }))
    expect(screen.getByTestId('deleted').textContent).toBe('a-1')
  })

  test('プレビューではエリアは選べず、一覧も出ない', () => {
    render(<Harness preview />)
    expect(screen.queryByText('エリア一覧')).toBeNull()
    expect(screen.queryByRole('button', { name: /動きは/ })).toBeNull()
  })
})

describe('エリアの名前づけ', () => {
  test('名前があればそれを、なければ通し番号を返す', () => {
    expect(areaDisplayName(AREAS[0], 0)).toBe('予約サイトへ')
    expect(areaDisplayName(AREAS[1], 1)).toBe('2番目のボタン')
    expect(areaDisplayName({ ...AREAS[0], label: '  ' }, 4)).toBe('5番目のボタン')
  })
})

describe('★V8 の面の名前（絵 Z0uO6・kmTab）', () => {
  test('v8 の編集では面の真ん中に名前を出し、見本（preview）では出さない', () => {
    const props = {
      areas: AREAS, size: 'large' as const, imageUrl: null, selectedAreaId: null,
      onSelectArea: () => {}, onAddArea: () => {}, onUpdateArea: () => {}, onDeleteArea: () => {},
      appearance: 'v8' as const, showAreaList: false, showTools: false,
    }
    const { unmount } = render(<CanvasEditor {...props} />)
    const first = screen.getAllByRole('button', { name: /動きは/ })[0]
    expect(first.textContent).toBe('予約サイトへ')
    unmount()
    render(<CanvasEditor {...props} preview />)
    expect(document.body.textContent ?? '').not.toContain('予約サイトへ')
  })
})
