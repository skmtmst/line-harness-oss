/** 機能オフの応答が、取得を始めた画面にだけ届くための世代。顧客本文・クエリは持たない。 */
export interface FeatureDisabledContext {
  pathname: string
  generation: number
}

let generation = 0
let current: FeatureDisabledContext | undefined

export function beginFeatureDisabledContext(pathname: string): FeatureDisabledContext {
  current = { pathname, generation: ++generation }
  return current
}

export function getFeatureDisabledContext(): FeatureDisabledContext | undefined {
  return current
}
