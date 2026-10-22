import * as p from "@clack/prompts";
import { execa } from "execa";

export function isSupportedNodeVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  const minimum: Record<number, readonly [number, number]> = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
  const required = minimum[major];
  return !!required && (minor > required[0] || (minor === required[0] && patch >= required[1]));
}

export async function checkDeps(): Promise<void> {
  const s = p.spinner();
  s.start("環境チェック中...");

  // Check Node.js version
  const nodeVersion = process.versions.node;
  if (!isSupportedNodeVersion(nodeVersion)) {
    s.stop("環境チェック失敗");
    p.cancel(`Node.js 22.23.4 / 24.22.1 / 26.12.1 以降の各対応系列が必要です（現在: ${nodeVersion}）`);
    process.exit(1);
  }

  // Check that npx is available (wrangler will be invoked via npx)
  try {
    await execa("npx", ["--version"]);
  } catch {
    s.stop("環境チェック失敗");
    p.cancel("npx が見つかりません。Node.js をインストールしてください。");
    process.exit(1);
  }

  s.stop("環境チェック完了");
}
