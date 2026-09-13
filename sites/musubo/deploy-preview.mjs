// First installation only. Subsequent updates deliberately require a new audit.
// No production build, DNS, Worker, database or mail configuration operations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build.mjs";

export const target = "/home/andu2021/musubo.jp/public_html";
export const publicFiles = [
  ".htaccess",
  "assets/site.css",
  "assets/site.js",
  "assets/symbol.svg",
  "terms/index.html",
  "privacy/index.html",
  "legal/index.html",
  "contact/index.html",
  "robots.txt",
  "sitemap.xml",
  "index.html",
];
const initialHtaccess =
  "e45d46d19a7a46bb8bafcd509db54ba2402332305aa38f8ac0e426fccde0815b";
const initialIndex =
  "3be3cd528345bb63771b934886d37c3c9011400095f0506ae3e596cea4ff6190";
const host = "andu2021@sv12504.xserver.jp";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function validateInitialState(names, htaccess, indexHash) {
  const allowed = [".htaccess", ".user.ini", "default_page.png", "index.html"];
  if (names.trim().split("\n").sort().join("\n") !== allowed.sort().join("\n"))
    throw new Error(
      "初期配置から変更されています。上書きせず再監査してください",
    );
  if (hash(htaccess) !== initialHtaccess || indexHash !== initialIndex)
    throw new Error("既存ページまたはHTTPS設定が監査時から変わっています");
}

export function remoteInstall(id) {
  if (!/^\d{14}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid release ID");
  // Only the two reviewed initial files may be replaced. All other names are new.
  return `set -euo pipefail
root=${quote(target)}
lock=/home/andu2021/.musubo-site-deploy.lock
backup=/home/andu2021/musubo-site-backups/${id}
for attempt in {1..30}; do
  if mkdir "$lock" 2>/dev/null; then acquired=1; break; fi
  sleep 2
done
test "\${acquired:-0}" = 1 || { echo '別の配備が実行中です。ロックは削除しません。'; exit 1; }
started=0
finish() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$started" = 1 ]; then
    mkdir -p "$backup/failed-output"
    for name in assets terms privacy legal contact robots.txt sitemap.xml; do
      if [ -e "$root/$name" ]; then mv "$root/$name" "$backup/failed-output/$name"; fi
    done
    tar -xzf "$backup/before.tar.gz" -C "$root" ./index.html ./.htaccess
    echo "設置に失敗したため初期ページへ復元しました。失敗した出力は $backup/failed-output に保存。"
  fi
  rmdir "$lock"
  exit "$status"
}
trap finish EXIT
test "$(readlink -f "$root")" = "$root"
test "$(ls -1A "$root" | LC_ALL=C sort | tr '\\n' '|')" = '.htaccess|.user.ini|default_page.png|index.html|'
for name in .htaccess .user.ini default_page.png index.html; do test ! -L "$root/$name"; done
test "$(sha256sum "$root/.htaccess" | cut -d ' ' -f 1)" = ${initialHtaccess}
test "$(sha256sum "$root/index.html" | cut -d ' ' -f 1)" = ${initialIndex}
umask 077
mkdir -p /home/andu2021/musubo-site-backups
mkdir "$backup"
tar -czf "$backup/before.tar.gz" -C "$root" .
tar -tzf "$backup/before.tar.gz" >/dev/null
sha256sum "$backup/before.tar.gz"
mkdir "$backup/payload"
tar -xzf - -C "$backup/payload"
cd "$backup/payload"
sha256sum -c SHA256SUMS
umask 022
started=1
mkdir "$root/assets" "$root/terms" "$root/privacy" "$root/legal" "$root/contact"
${publicFiles.map((file) => `install -m 644 ${quote(file)} ${quote(`${target}/${file}`)}`).join("\n")}
cd "$root"
sha256sum -c "$backup/payload/SHA256SUMS"
echo '確認用サイトを設置しました。DNSはこのスクリプトでは変更していません。'
echo "復元用バックアップ: $backup/before.tar.gz"
`;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--apply") || flags.length > 1)
    throw new Error("Usage: node sites/musubo/deploy-preview.mjs [--apply]");
  const apply = flags.includes("--apply");
  const run = (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      ...options,
    });
  const git = (...args) => run("git", args).trim();
  if (git("status", "--porcelain"))
    throw new Error("作業ツリーがクリーンではありません");
  run("git", ["fetch", "origin", "codex/development"]);
  const sha = git("rev-parse", "HEAD");
  if (apply && sha !== git("rev-parse", "origin/codex/development"))
    throw new Error("GitHub最新 codex/development と一致していません");
  const key = process.env.MUSUBO_SSH_KEY || join(homedir(), ".ssh/id_ed25519");
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-p",
    "10022",
    "-i",
    key,
    host,
  ];
  const remote = (command, input) =>
    run("ssh", [...sshArgs, command], { input });
  const htaccess = remote(
    `test ! -L ${quote(target)}; sed -n '1,100p' ${quote(`${target}/.htaccess`)}`,
  );
  const indexHash = remote(
    `sha256sum ${quote(`${target}/index.html`)} | cut -d ' ' -f 1`,
  ).trim();
  validateInitialState(remote(`ls -1A ${quote(target)}`), htaccess, indexHash);
  const work = await mkdtemp(join(tmpdir(), "musubo-xserver-"));
  const output = join(work, "public");
  await build({ output });
  const headers = await readFile(join(output, ".htaccess"), "utf8");
  await writeFile(
    join(output, ".htaccess"),
    `${htaccess}\n# BEGIN musubo review site\n${headers}# END musubo review site\n`,
  );
  for (const file of publicFiles.filter((file) => file.endsWith(".html"))) {
    const html = await readFile(join(output, file), "utf8");
    if (
      !html.includes("noindex,nofollow") ||
      !html.includes("確認用サイト") ||
      !html.includes("https://nen-line-stg-admin.pages.dev/register")
    )
      throw new Error(`確認用の安全表示がありません: ${file}`);
  }
  console.log(
    `対象: https://musubo.jp / ${target}\nSHA: ${sha}\nモード: ${apply ? "apply" : "dry-run"}\n生成物: ${work}`,
  );
  // Always print a real no-write transfer comparison before any remote write.
  const transport = ["ssh", ...sshArgs.slice(0, -1)].map(quote).join(" ");
  console.log(
    run("rsync", [
      "-rinc",
      "--itemize-changes",
      "-e",
      transport,
      `${output}/`,
      `${host}:${target}/`,
    ]),
  );
  if (!apply) return;
  const checksums = await Promise.all(
    publicFiles.map(
      async (file) => `${hash(await readFile(join(output, file)))}  ${file}`,
    ),
  );
  await writeFile(join(output, "SHA256SUMS"), checksums.join("\n") + "\n");
  const archive = join(work, "payload.tar.gz");
  run("tar", ["-czf", archive, "-C", output, ...publicFiles, "SHA256SUMS"]);
  const id =
    new Date().toISOString().replace(/\D/g, "").slice(0, 14) +
    "-" +
    sha.slice(0, 12);
  console.log(
    remote(`bash -c ${quote(remoteInstall(id))}`, await readFile(archive)),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
