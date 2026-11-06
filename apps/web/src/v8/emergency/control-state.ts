type ControlMessage = { tone: 'success' | 'warning' | 'danger'; text: string }

type CurrentRequestOptions<T> = {
  request: () => Promise<T>
  isCurrent: () => boolean
  onSuccess: (value: T) => void
  onError: (error: unknown) => void
  onSettled?: () => void
}

/**
 * Apply an asynchronous result only while it still belongs to the selected
 * account/request generation. This is exported for the behavior test because
 * the important contract is the ordering, not the source text.
 */
export async function runCurrentRequest<T>({
  request,
  isCurrent,
  onSuccess,
  onError,
  onSettled,
}: CurrentRequestOptions<T>): Promise<void> {
  try {
    const value = await request()
    if (isCurrent()) onSuccess(value)
  } catch (error) {
    if (isCurrent()) onError(error)
  } finally {
    if (isCurrent()) onSettled?.()
  }
}

export function isEmergencyMutationLocked(needsReload: boolean, running: boolean): boolean {
  return needsReload || running
}

type EmergencySafetyEvent = 'conflict' | 'forbidden' | 'operation-failed' | 'reload-start' | 'reload-success' | 'reload-failure'

export function emergencySafetyTransition(event: EmergencySafetyEvent): {
  clearPreview: boolean
  closeDialogs: boolean
  needsReload: boolean
  reloading: boolean
  message: ControlMessage | null
} {
  if (event === 'conflict') return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: false,
    message: { tone: 'warning', text: '別の管理者が先に変更しました。最新の状態を読み直してから、もう一度確認してください。' },
  }
  /*
   * N-453: 403は「押した本人に権限が無い」。本人確認の窓を開けたままだと、
   * 理由と次の行動が窓の裏へ回って見えず、同じ要求をもう一度送れてしまう。
   * 窓と入力と要求鍵を閉じて、理由を前面に出し、送り直せなくする。
   */
  if (event === 'forbidden') return {
    clearPreview: false,
    closeDialogs: true,
    needsReload: false,
    reloading: false,
    message: null,
  }
  /*
   * N-453(3回目の差し戻し): 403・409(版競合)以外の失敗(400/429/5xx等)は
   * 本人確認の窓が `fixed inset-0` の覆いつきで開いたままだと、帯(理由)が
   * 覆いの裏へ回って運用者から見えない。403と同じく窓を閉じて理由を前面へ出す。
   */
  if (event === 'operation-failed') return {
    clearPreview: false,
    closeDialogs: true,
    needsReload: false,
    reloading: false,
    message: null,
  }
  if (event === 'reload-start') return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: true,
    message: null,
  }
  if (event === 'reload-success') return {
    clearPreview: false,
    closeDialogs: false,
    needsReload: false,
    reloading: false,
    message: { tone: 'success', text: '最新の状態を読み直しました。内容を確認して、もう一度実行してください。' },
  }
  return {
    clearPreview: true,
    closeDialogs: true,
    needsReload: true,
    reloading: false,
    message: { tone: 'danger', text: '最新の状態を読み直せませんでした。時間をおいてもう一度読み直してください。' },
  }
}
