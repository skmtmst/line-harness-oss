import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const profile = readFileSync(new URL('./google-profile.tsx', import.meta.url), 'utf8')

describe('Google変更提案の確認（R108）', () => {
  it('比較できない項目は管理画面への導線を出し、確認範囲を示す', () => {
    expect(profile).toContain('この項目はこの画面で比較できません。')
    expect(profile).toContain('https://business.google.com/')
    expect(profile).toContain('Googleの管理画面で確認する')
    expect(profile).toContain('この画面で比較できるのは、店舗名・住所・電話番号・ウェブサイト・通常の営業時間・特別営業時間・店舗紹介文です。')
    expect(profile).not.toContain('この画面では表示できない項目です')
  })
})

describe('曜日別営業時間のスマホ表示（R109）', () => {
  it('狭い画面では曜日ごとの縦並びにし、時刻の欄を全幅で並べる', () => {
    expect(profile).toContain('sm:contents')
    expect(profile).toContain('flex w-full items-center gap-2 sm:w-auto')
    expect(profile).toContain('hidden items-center gap-3 px-4 text-caption font-semibold sm:flex')
  })
})
