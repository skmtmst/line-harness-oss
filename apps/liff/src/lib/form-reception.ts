export function choiceReceptionLabel(choice?: { remaining: number; full: boolean }): string {
  return choice ? `（${choice.full ? '受付終了' : `残り${choice.remaining}件`}）` : '';
}
