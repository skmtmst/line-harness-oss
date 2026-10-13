export type StepperState = 'done' | 'current' | 'todo' | 'attention'

/** 旧名。Stepper に寄せたので、新しくは StepperState を使う。 */
export type StepState = StepperState

export interface StepperStep {
  /** 省略時は label を使う。同名の段が並ぶときだけ付ける。 */
  key?: string
  label: string
  /** 1始まりの表示番号。省略時は上からの順番。 */
  order?: number
  /**
   * 入力が済んだか（done／まだか todo／直すところがあるか attention）。
   * 「いまいる所」はここでは決めない。`currentKey`（段の居場所）と分ける（設計 C）。
   * `currentKey` を渡さない昔の呼び方は、そのまま state の `current` を居場所にする。
   */
  state: StepperState
  /** 押したときに飛ぶ節の id。済み・要修正の段だけに付ける。 */
  anchor?: string
  /** anchor の代わりに押したときの動き。済み・要修正の段だけに付ける。 */
  onSelect?: () => void
}
