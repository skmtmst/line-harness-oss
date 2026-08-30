import { describe, expect, it } from 'vitest'
import {
  filterFavorites,
  toggleFavorite,
  updatedLabel,
} from './template-favorites'

const TEMPLATES = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }, { id: 't6' }]

describe('よく使うテンプレート', () => {
  it('★を押すたびに入れ替える', () => {
    expect(toggleFavorite([], 't2')).toEqual(['t2'])
    expect(toggleFavorite(['t2'], 't2')).toEqual([])
    expect(toggleFavorite(['t2'], 't5')).toEqual(['t2', 't5'])
  })

  it('登録したものだけを出す', () => {
    expect(filterFavorites(TEMPLATES, ['t3', 't5']).map((t) => t.id)).toEqual(['t3', 't5'])
  })

  it('1件も登録が無いときに先頭5件で埋めない', () => {
    /*
     * 前は `filtered.slice(0, 5)` を「よく使う」と呼んでいた。使った回数も
     * 選んだ覚えも見ていないので、**測っていないことを測ったように
     * 見せていた**。並び順が変われば中身も変わる。
     */
    expect(filterFavorites(TEMPLATES, [])).toEqual([])
  })

  it('消えたテンプレートの★は無視する', () => {
    expect(filterFavorites(TEMPLATES, ['t1', 'もう無いid']).map((t) => t.id)).toEqual(['t1'])
  })
})

describe('更新日', () => {
  it('読めなければ「—」にする', () => {
    expect(updatedLabel(null)).toBe('—')
    expect(updatedLabel(undefined)).toBe('—')
    expect(updatedLabel('こわれた日付')).toBe('—')
  })

  it('JSTで出す', () => {
    // UTCのままだと日付が1日ずれる。
    expect(updatedLabel('2026-08-18T15:30:00.000Z')).toBe('2026/08/19')
  })
})
