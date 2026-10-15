// 固定した対応表は読取専用。出力を別の撮影用JSONへ保存してMEASURE_MAPで使う。
// node scripts/visual-qa/measure2-map.mjs <固定した対応表.json> > <撮影用の写し.json>
import { readFileSync } from 'node:fs'
import { applyBoardStateProfiles } from './measure2-board-state.mjs'

const source = process.argv[2]
if (!source) throw new Error('固定した対応表のパスを指定してください')
const map = JSON.parse(readFileSync(source, 'utf8'))
process.stdout.write(JSON.stringify(applyBoardStateProfiles(map), null, 2) + '\n')
