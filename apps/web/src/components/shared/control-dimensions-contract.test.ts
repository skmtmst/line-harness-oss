// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextField } from './text-field'
import Select from './select'
import SearchField from './search-field'
import Button from './button'
afterEach(cleanup)

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('V8 の入力・選択・押し口規定', () => {
  it('入力と操作の名前・値・更新先を保つ', () => {
    const change = vi.fn(), save = vi.fn()
    render(createElement('div', null,
      createElement(TextField, { 'aria-label': '名前', value: '初期値', onChange: event => change(event.target.value) }),
      createElement(SearchField, { 'aria-label': '検索', value: '', onChange: () => {} }),
      createElement(Select, { 'aria-label': '状態', value: 'all', options: [{ value: 'all', label: 'すべて' }], onChange: () => {} }),
      createElement(Button, { onClick: save }, '保存する'),
    ))
    expect((screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement).value).toBe('初期値')
    expect(screen.getByRole('searchbox', { name: '検索' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '状態' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: '新しい値' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(change).toHaveBeenCalledWith('新しい値')
    expect(save).toHaveBeenCalledOnce()
  })

  it('素の選択欄にも高さ・白背景・右12pxの矢印余白を適用する', () => {
    const globals = read('../../app/globals.css')
    const rule = globals.match(/select:not\(\[multiple\]\):not\(\.appearance-none\)\s*{([^}]*)}/s)?.[1]

    expect(rule).toBeDefined()
    expect(rule).toMatch(/min-height:\s*36px/)
    expect(rule).toMatch(/padding-right:\s*36px/)
    expect(rule).toMatch(/background-color:\s*var\(--color-canvas\)/)
    expect(rule).toMatch(/background-position:\s*right 12px center/)
  })

  it('共有部品の CSS Module はすべて components レイヤーに置く', () => {
    /*
     * #718: レイヤーに属さない部品 CSS は utilities レイヤーより常に強く、
     * 呼び出し側の `w-full` や `h-8` がエラーも出さずに無視される
     * （予約設定のプルダウンはみ出し・カレンダー前後ボタンの高さ不整合で発生）。
     * components レイヤーに入れると既定値は部品が持ち、
     * 画面側のクラスは指定したときだけ勝つ。
     */
    const dir = dirname(fileURLToPath(import.meta.url))
    const modules = readdirSync(dir).filter((name) => name.endsWith('.module.css'))
    const offenders = modules.filter((name) => !read(`./${name}`).includes('@layer components'))
    expect(offenders).toEqual([])
  })

  it('components loaded before globals still establish the same cascade order', () => {
    expect(read('../../app/globals.css')).toMatch(/^@layer properties,\s*theme,\s*base,\s*components,\s*utilities;/)
    const modules = readdirSync(dirname(fileURLToPath(import.meta.url))).filter(name => name.endsWith('.module.css'))
    for (const name of modules) {
      expect(read(`./${name}`), name).toMatch(/^@layer properties,\s*theme,\s*base,\s*components,\s*utilities;/)
    }
  })

  it('代表的な画面側上書きも規定値に戻す', () => {
    const users = read('../../app/users/users-screen.tsx')
    const tags = read('../../v8/tags/tags-tab.tsx')
    const broadcasts = read('../../v8/broadcasts/list.tsx')

    expect(users).not.toContain('className="h-9')
    expect(users).toContain('aria-label="UID連携で絞り込む"')
    expect(users).toContain('aria-label="所属アカウントで絞り込む"')
    expect(tags).not.toContain('v6-select-tight h-9')
    // ★管理画面 `Xn1Mz`：検索は共通 ListToolbar の1行目へそろえた（検索の高さ・幅は
    // 部品が持つ）。画面側の直書き検索 input（h-10 min-w-45 flex-1）に戻さない。
    // 選び口は共通 Select（素の select は置かない #640）。幅は部品の既定。
    expect(tags).toContain('<ListToolbar')
    expect(tags).not.toContain('type="search"')
    expect(tags).not.toContain('<select')
    expect(tags).toContain('aria-label="使用状態で絞り込む"')
    expect(tags).toContain('<PageSizeSelect')
    expect(broadcasts).toContain('<SearchField')
    expect(broadcasts).not.toContain('type="search"')
  })
})
