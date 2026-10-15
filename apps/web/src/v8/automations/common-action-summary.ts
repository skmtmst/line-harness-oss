import type { CommonActionStep, CommonActionResources } from '@/lib/api'

/** 処理の行の2行目（どれを・どれだけ）。選んでいないときは「〇〇を選ぶ」。 */
export function stepSummary(step: CommonActionStep, resources: CommonActionResources): string {
  const nameOf = (list: Array<{ id: string; name: string }>, id: unknown, label: string) => {
    const found = list.find((item) => item.id === String(id ?? ''))
    return found ? `${label}「${found.name}」` : `${label}を選ぶ`
  }
  switch (step.type) {
    case 'add_tag':
    case 'remove_tag':
      return nameOf(resources.tags, step.params.tagId, 'タグ')
    case 'start_scenario':
    case 'stop_scenario':
    case 'resume_scenario':
      return nameOf(resources.scenarios, step.params.scenarioId, 'シナリオ')
    case 'send_webhook':
      return nameOf(resources.webhooks, step.params.webhookId, '送信先')
    case 'switch_rich_menu':
      return nameOf(resources.richMenus, step.params.richMenuPageId, 'リッチメニュー')
    case 'common_action':
      return nameOf(resources.commonActions, step.params.commonActionId, '共通アクション')
    case 'send_message': {
      if (step.params.templateId) return nameOf(resources.templates, step.params.templateId, 'テンプレート')
      const content = String(step.params.content ?? '').trim()
      return content ? content.slice(0, 40) : '送る文を入れる'
    }
    case 'wait': {
      const minutes = Number(step.params.durationMinutes ?? step.params.minutes ?? 0)
      if (!minutes) return '待つ時間を決める'
      if (minutes % 1440 === 0) return `${minutes / 1440} 日`
      if (minutes % 60 === 0) return `${minutes / 60} 時間`
      return `${minutes} 分`
    }
    case 'set_metadata': {
      const keys = Object.keys((step.params.values as Record<string, unknown> | undefined) ?? {}).filter(Boolean)
      return keys.length ? `友だち情報「${keys.join('・')}」` : '友だち情報を選ぶ'
    }
    case 'branch':
      return '条件に合うとき・合わないときで分ける'
    default:
      return ''
  }
}

