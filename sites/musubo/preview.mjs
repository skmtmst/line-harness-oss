import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "dist/preview");
const port = Number(process.env.MUSUBO_PREVIEW_PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xml": "application/xml",
};
const server = createServer(async (request, response) => {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, headers).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname.split("/").some((part) => part.startsWith(".")))
      throw new Error("Hidden file");
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(root + sep))
      throw new Error("Outside root");
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const file = await readFile(path);
    response.writeHead(200, {
      ...headers,
      "Content-Type": types[extname(path)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : file);
  } catch {
    response
      .writeHead(404, {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
      })
      .end("ページが見つかりません。ホームへお戻りください。");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`musubo preview: http://127.0.0.1:${port}`),
);
