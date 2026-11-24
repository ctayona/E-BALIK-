// Uses an installed Chromium browser, bundled local components, mocked fetch and a network-blocking CSP.
import { build } from "esbuild"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
const browser = process.argv[2]
if (!browser) throw Error("Supply the local Chromium/Edge executable path.")
const folder = await mkdtemp(
  path.resolve("node_modules/.cache/event-tag-browser-"),
)
await build({
  entryPoints: ["scripts/fixtures/event-smart-tags-browser.tsx"],
  outfile: folder + "/app.js",
  bundle: true,
  jsx: "automatic",
  alias: {
    "@": path.resolve("Users/Frontend/src"),
    react: path.resolve("node_modules/react"),
    "react-dom": path.resolve("node_modules/react-dom"),
  },
  define: {
    "import.meta.env": JSON.stringify({
      VITE_API_URL: "http://offline.invalid",
    }),
  },
  loader: {
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".jpg": "dataurl",
    ".png": "dataurl",
  },
})
const css = await readFile(folder + "/app.css", "utf8")
const compiledCss = async (dist) =>
  (
    await Promise.all(
      (
        await readdir(dist)
      )
        .filter((f) => f.endsWith(".css"))
        .map((f) => readFile(path.join(dist, f), "utf8")),
    )
  ).join("\n")
for (const [kind, dist] of [
  ["user", "Users/Frontend/dist/assets"],
  ["admin", "Admin/Frontend/dist/assets"],
]) {
  const themed = await compiledCss(dist)
  await writeFile(
    folder + "/" + kind + ".html",
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data: blob: file:; font-src data:"><style>*{box-sizing:border-box}body{margin:0}' +
      themed +
      css +
      '</style><main id="root"></main><pre id="result"></pre><script src="app.js"></script>',
  )
}
// Chromium enforces a minimum native window width. Override the CSS viewport via DevTools.
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = path.join(folder, "profile")
const child = spawn(
  browser,
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
)
let ws
try {
  let port
  for (let i = 0; i < 80 && !port; i++) {
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8"))
        .split("\n")[0]
        .trim()
    } catch {
      await pause(100)
    }
  }
  if (!port) throw Error("Local browser unavailable")
  const pages = await (
    await fetch("http://127.0.0.1:" + port + "/json/list")
  ).json()
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let sequence = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data)
    if (d.id) {
      const cb = pending.get(d.id)
      pending.delete(d.id)
      if (d.error) cb.reject(Error(d.error.message))
      else cb.resolve(d.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send("Page.enable")
  for (const mode of [
    "phone-owner",
    "phone-desk",
    "desktop-desk",
    "phone-scan",
    "phone-capture",
    "desktop-admin",
    "phone-workspace",
    "desktop-admin-off",
  ]) {
    const phone = mode.startsWith("phone"),
      kind =
        mode.includes("admin") || mode.includes("workspace") ? "admin" : "user"
    await send("Emulation.setDeviceMetricsOverride", {
      width: phone ? 360 : 1280,
      height: phone ? 720 : 900,
      deviceScaleFactor: 1,
      mobile: phone,
    })
    await send("Page.navigate", {
      url:
        pathToFileURL(folder + "/" + kind + ".html").href +
        "?case=" +
        mode +
        "#" +
        mode,
    })
    let result
    for (let i = 0; i < 100; i++) {
      await pause(100)
      result = (
        await send("Runtime.evaluate", {
          expression:
            "({mode:location.hash.slice(1),qa:document.body?.dataset.qa,error:document.querySelector('#result')?.textContent})",
          returnByValue: true,
        })
      ).result.value
      if (result?.mode === mode && result.qa) break
    }
    if (result?.qa !== "PASS")
      throw Error(mode + ": " + (result?.error || "No fixture result"))
    console.log(mode + " passed")
  }
  await Promise.race([send("Browser.close"), pause(500)])
} finally {
  ws?.close()
  child.kill()
}
