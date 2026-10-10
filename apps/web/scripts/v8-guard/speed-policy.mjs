/** CI run 38040188674 / job 114178841250: 84/67=1.254、63/50=1.26。
 * 観測した最大倍率を切り上げて1.30。時間だけ補正し、JSの量は補正しない。
 * 20%の悪化幅と合わせても1.56倍なので、2倍の悪化を検出できる。
 */
export const SAMPLE_COUNT = 5
export const CI_TIME_FACTOR = 1.30
export const REGRESSION_FACTOR = 1.2
export const LONG_TASK_FLOOR_MS = 50

export function speedPolicy(profile = process.env.V8_SPEED_PROFILE ?? (process.env.CI === 'true' ? 'ci' : 'local')) {
  if (!['local', 'ci'].includes(profile)) throw new Error(`未知の速度測定環境: ${profile}`)
  return { profile, sampleCount: SAMPLE_COUNT, timeFactor: profile === 'ci' ? CI_TIME_FACTOR : 1 }
}
