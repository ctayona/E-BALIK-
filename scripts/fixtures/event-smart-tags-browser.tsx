import React from "react"
import { createRoot } from "react-dom/client"
import EventStorageItems from "../../shared/EventStorageItems"
import EventTagPage from "../../Users/Frontend/src/app/pages/event-desk/EventTagPage"
import {
  EventBatchPurpose,
  WorkspaceEventTags,
} from "../../Admin/Frontend/src/pages/events/EventTagInventory"
const mode = location.hash.slice(1)
const id = "11111111-1111-4111-8111-111111111111"
const items = Array.from({ length: 24 }, (_, i) => ({
  registration_id: id,
  event_id: id,
  code: id,
  item_name: "Bottle " + i,
  description: "Blue bottle",
  storage: "Shelf 02",
  status: "held",
  version: 2,
  created_at: new Date().toISOString(),
  received_at: new Date().toISOString(),
  pin: "ABC123",
  recovery_consent: false,
}))
const actions: Record<string, unknown>[] = []
const uploads: Record<string, unknown>[] = []
const reply = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
window.fetch = async (url, opts) => {
  const path = new URL(String(url), "http://offline.invalid").pathname
  if (path.endsWith("/register")) {
    const body = opts?.body as FormData
    if (
      !(body.get("photo") instanceof File) ||
      !new Headers(opts?.headers).has("Authorization")
    )
      throw Error("Missing live photo or session")
    uploads.push(JSON.parse(String(body.get("payload"))))
    return new Response(JSON.stringify({ error: "Simulated lost response" }), {
      status: 409,
    })
  }
  if (path.endsWith("/capability"))
    return reply({ mode: mode.includes("off") ? "off" : "on" })
  if (path.endsWith("/inventory"))
    return reply(
      String(url).includes("batch=")
        ? {
            tags: [
              {
                code: id,
                url: "https://example.invalid/event-tag/" + id,
                version: 1,
                disabled: false,
              },
            ],
            printable: true,
          }
        : { batches: [{ batch_id: id, label: "Theatre" }] },
    )
  if (path.endsWith("/desk")) return reply({ version: 0, enabled: false })
  if (path.endsWith("/photo"))
    return new Response(
      new Blob(
        ['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'],
        { type: "image/svg+xml" },
      ),
    )
  if (path.endsWith("/items"))
    return reply({
      rows: items.map((r, i) => ({
        ...r,
        registration_id:
          r.registration_id.slice(0, -2) + String(i).padStart(2, "0"),
      })),
      role: mode.includes("owner") ? "owner" : "manager",
      more: false,
    })
  if (path.endsWith("/actions")) {
    actions.push(JSON.parse(String(opts?.body)))
    return reply({ outcome: "saved", batch_id: id })
  }
  if (path.includes("/scan/"))
    return reply({
      event_id: id,
      allocation_id: id,
      version: 1,
      name: "Theatre event",
      venue: "Grand Theatre",
      desk_instructions: "East entrance",
    })
  throw Error("Unexpected offline request " + path)
}
const request = (path: string, init?: RequestInit) =>
  fetch("http://offline.invalid" + path, init)
const el = (q: string) => document.querySelector(q) as HTMLElement | null
const wait = async (test: () => unknown) => {
  for (let i = 0; i < 80; i++) {
    if (test()) return
    await new Promise((r) => setTimeout(r, 30))
  }
  throw Error("Timed out waiting for " + test)
}
const button = (title: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === title,
  )
const change = (select: HTMLSelectElement, v: string) => {
  select.value = v
  select.dispatchEvent(new Event("change", { bubbles: true }))
}
async function run() {
  const root = createRoot(document.getElementById("root")!)
  if (mode.includes("admin")) {
    root.render(
      <EventBatchPurpose
        personal={() => {
          document.body.dataset.personal = "true"
        }}
      />,
    )
    await wait(() => button("Generate batch"))
    button("Generate batch")!.click()
    if (document.body.dataset.personal !== "true")
      throw Error("Personal issuance default")
    if (!mode.includes("off")) {
      await wait(() => el('[aria-label="Batch purpose"]'))
      change(el('[aria-label="Batch purpose"]') as HTMLSelectElement, "event")
      await wait(() => button("Open event inventory"))
      button("Open event inventory")!.click()
      await wait(() => button("Generate event QR batch"))
    }
  } else if (mode.includes("workspace")) {
    root.render(<WorkspaceEventTags event={id} />)
    await wait(() => el("summary"))
    el("summary")!.click()
    await wait(() => document.querySelector('option[value="' + id + '"]'))
    change(el("select") as HTMLSelectElement, id)
    await wait(() => button("Assign 1 available to this event"))
    button("Assign 1 available to this event")!.click()
    await wait(() => actions.length)
    if (actions[0].action !== "assign_batch" || actions[0].event_id !== id)
      throw Error("Batch scoped to wrong event")
  } else if (mode.includes("capture")) {
    localStorage.setItem("ebalik_token", "offline-session")
    Object.defineProperty(navigator, "mediaDevices", {
      value: {},
      configurable: true,
    })
    const original = window.matchMedia.bind(window)
    window.matchMedia = (q) =>
      q === "(pointer: coarse)"
        ? { ...original(q), matches: true } as MediaQueryList
        : original(q)
    root.render(<EventTagPage code={id} />)
    await wait(() => button("Request check-in"))
    if (!button("Request check-in")!.disabled) throw Error("Photo missing")
    const set = (q: string, v: string) => {
      const input = el(q)!
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )!.set!.call(input, v)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    set('input[placeholder="Water bottle"]', "Flask bottle")
    set("textarea", "Blue insulated bottle")
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 16
    const blob = await new Promise<Blob>((r) =>
      canvas.toBlob((b) => r(b!), "image/png"),
    )
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], "camera.png", { type: "image/png" }))
    const input = document.querySelector("input[capture]") as HTMLInputElement
    input.files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await wait(() => !button("Request check-in")!.disabled)
    button("Request check-in")!.click()
    await wait(() => uploads.length === 1)
    await wait(() => button("Request check-in"))
    button("Request check-in")!.click()
    await wait(() => uploads.length === 2)
    if (
      uploads[0].request_id !== uploads[1].request_id ||
      uploads[0].allocation_id !== id ||
      uploads[0].item_name !== "Flask bottle"
    )
      throw Error("Stale request identity or content")
  } else if (mode.includes("scan")) {
    root.render(<EventTagPage code={id} />)
    await wait(() => button("Sign in or create an account"))
    if (
      !document.body.innerText.includes("East entrance") ||
      document.body.innerText.includes("Shelf 02")
    )
      throw Error("Public scan projection")
  } else {
    const owner = mode.includes("owner")
    root.render(
      <EventStorageItems
        request={request}
        scope={owner ? "mine" : "staff"}
        title="Fixture register"
        mode="on"
      />,
    )
    await wait(() => button("View"))
    const region = el(".ets-scroll")!
    if (region.scrollHeight <= region.clientHeight)
      throw Error("Unbounded register")
    button("View")!.click()
    await wait(() => el("dialog[open]"))
    if (
      owner !== document.body.innerText.includes("ABC123") ||
      owner === document.body.innerText.includes("Shelf 02")
    )
      throw Error("Owner/staff projection")
    if (!owner) {
      change(el("dialog select") as HTMLSelectElement, "collect")
      await wait(() => el('input[name="pin"]'))
      if (!(el('input[name="identity_checked"]') as HTMLInputElement).required)
        throw Error("Missing identity confirmation")
    }
    const bounds = el("dialog")!.getBoundingClientRect()
    if (
      bounds.left < 0 ||
      bounds.right > innerWidth + 1 ||
      bounds.bottom > innerHeight + 1
    )
      throw Error("Dialog overflow")
  }
  if (mode.startsWith("phone") && innerWidth > 399)
    throw Error("Phone viewport measured " + innerWidth)
  if (document.documentElement.scrollWidth > innerWidth + 1)
    throw Error("Horizontal page overflow")
  document.body.dataset.qa = "PASS"
}
run().catch((e) => {
  document.body.dataset.qa = "FAIL"
  document.getElementById("result")!.textContent = e.message
})
