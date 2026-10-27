import { describe, expect, it } from 'vitest'

const hours = readFileSync(new URL('../../../v8/restaurant/google/profile-hours.tsx', import.meta.url), 'utf8')

describe('曜日別営業時間のスマホ表示（R109）', () => {
  it('狭い画面では曜日ごとの縦並びにし、時刻の欄を全幅で並べる', () => {
    expect(hours).toContain('WEEKDAYS.map((day)')
    expect(hours).toContain('<Card key={day} appearance="outlined" layout="vertical"')
    expect(hours).toContain('<Select size="full"')
    expect(hours).not.toContain('sm:contents')
  })
})
