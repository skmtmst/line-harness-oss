import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OPERATION_CAPABILITIES } from '@line-crm/db';

import {
  OPERATION_PROXY_CAPABILITY_HEADER,
  OPERATION_SEND_PATHS,
  sendPathsForCapability,
  validateSendPathRegistry,
} from './operation-send-paths.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/*
 * 送信経路の台帳の契約テスト (#1050)。
 *
 * 「緊急停止ボタンがある」だけでは各経路が止まる保証にならない。
 * 台帳が挙げるすべての経路について、停止対象なら停止状態を読む実装の
 * 証跡 (file + marker) が実在すること、対象外なら理由があることを
 * ここで固定する。証跡が消えた・経路が抜けた変更はこのテストで落ちる。
 */
describe('送信経路の台帳 (#1050)', () => {
  it('台帳自体が検査を通る (重複・理由なし対象外・空の証跡がない)', () => {
    expect(validateSendPathRegistry()).toEqual([]);
  });

  it('停止対象の経路はすべて既知の停止対象名を持つ', () => {
    for (const path of OPERATION_SEND_PATHS) {
      if (path.capability === null) continue;
      expect(OPERATION_CAPABILITIES, path.id).toContain(path.capability);
    }
  });

  it('対象外の経路はすべて理由を持ち、証跡を名乗らない', () => {
    for (const path of OPERATION_SEND_PATHS.filter((entry) => entry.capability === null)) {
      expect(path.excludedReason, path.id).toBeTruthy();
    }
  });

  it('証跡 (file + marker) が実装に実在する', () => {
    for (const path of OPERATION_SEND_PATHS) {
      for (const enforcement of path.enforcement) {
        const fullPath = join(REPO_ROOT, enforcement.file);
        expect(existsSync(fullPath), `${path.id}: ${enforcement.file} が無い`).toBe(true);
        const source = readFileSync(fullPath, 'utf8');
        expect(
          source.includes(enforcement.marker),
          `${path.id}: ${enforcement.file} に ${enforcement.marker} が無い`,
        ).toBe(true);
      }
    }
  });

  it('すべての停止対象に1つ以上の経路がぶら下がる', () => {
    for (const capability of OPERATION_CAPABILITIES) {
      expect(
        sendPathsForCapability(capability).length,
        `${capability} に対応する経路が台帳に無い`,
      ).toBeGreaterThan(0);
    }
  });

  it('プロキシ経由の経路名乗りヘッダが既定値として一斉配信へ倒れる契約を持つ', () => {
    // ヘッダ名の値自体を固定する。うっかり改名すると呼び出し側と proxy が
    // 食い違い、経路名乗りが黙って既定 (broadcast_dispatch) へ落ちる。
    expect(OPERATION_PROXY_CAPABILITY_HEADER).toBe('X-Line-Harness-Capability');
  });
});
