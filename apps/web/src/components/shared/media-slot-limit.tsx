'use client'



/** 公開前にも同じ上限を示す。確認欄が独自の上限文を持たない。 */
export function MediaLimitNote({ kind = '画像', maxMb }: { kind?: string; maxMb: number }) {
  return <p>{kind}は{maxMb}MBまで。超えると登録できません</p>
}
