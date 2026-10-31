export function questionChoiceLabelProblem(label: string): string | null {
  return label.length > 20 ? 'ボタンの文字は20文字以内で入力してください。' : null
}

export function firstQuestionChoiceLabelProblem(question: { choices: readonly { label: string }[] }) {
  const index = question.choices.findIndex(choice => questionChoiceLabelProblem(choice.label))
  return index < 0 ? null : { index, message: `選択肢 ${index + 1} の${questionChoiceLabelProblem(question.choices[index].label)}` }
}
