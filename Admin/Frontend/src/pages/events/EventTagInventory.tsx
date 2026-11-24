import { useEffect, useRef, useState } from "react"
import { API_URL, adminMutationRequest, getAuthHeaders } from "../../utils/api"
import EventStorageItems, {
  useEventTagMode,
  type EventTagRequest,
} from "../../../../../shared/EventStorageItems"
import { BTN } from "../../components/ui/primitives"
import AdminModal from "../../components/ui/AdminModal"

export const adminTagRequest: EventTagRequest = async (path, init = {}) => {
  const url = API_URL + "/api/admin/events/event-tags" + path
  const options = {
    cache: "no-store" as const,
    ...init,
    headers: getAuthHeaders(),
  }
  const res =
    init.method === "POST"
      ? await adminMutationRequest(url, options, "Update event tags")
      : await fetch(url, options)
  if (!res.ok) {
    const v = await res.json().catch(() => ({}))
    throw Error(v.error || "Event inventory unavailable.")
  }
  return res
}
interface Batch {
  batch_id: string
  label: string
}
interface Tag {
  code: string
  version: number
  disabled: boolean
  held: string | null
  url: string
  allocation: { event_id: string; event_workspaces: { name: string } } | null
}
function download(blob: Blob, file: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.download = file
  a.href = url
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
function Inventory({ event, mode }: { event?: string; mode: string }) {
  const [batches, setBatches] = useState<Batch[]>([]),
    [batch, setBatch] = useState(""),
    [tags, setTags] = useState<Tag[]>([])
  const [offset, setOffset] = useState(0),
    [desk, setDesk] = useState({ enabled: false, version: 0 })
  const [label, setLabel] = useState(""),
    [count, setCount] = useState(10)
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("")
  const [printable, setPrintable] = useState(false),
    [warning, setWarning] = useState("")
  const last = useRef<{ body: string; key: string } | null>(null)
  useEffect(() => {
    const c = new AbortController()
    setLoaded(false)
    setTags([])
    setError("")
    async function load() {
      const groups = await (
        await adminTagRequest("/inventory?offset=" + offset, {
          signal: c.signal,
        })
      ).json()
      if (c.signal.aborted) return
      setBatches(groups.batches)
      if (event) {
        const d = await (
          await adminTagRequest("/desk?event=" + event, { signal: c.signal })
        ).json()
        if (!c.signal.aborted) setDesk(d)
      }
      if (batch) {
        const v = await (
          await adminTagRequest("/inventory?batch=" + batch, {
            signal: c.signal,
          })
        ).json()
        if (!c.signal.aborted) {
          setTags(v.tags)
          setPrintable(v.printable)
          setWarning(v.warning)
        }
      }
      if (!c.signal.aborted) setLoaded(true)
    }
    load().catch((e) => {
      if (!c.signal.aborted) setError(e.message)
    })
    return () => c.abort()
  }, [offset, batch, event, revision])
  async function mutate(body: Record<string, unknown>) {
    setBusy(true)
    setError("")
    const signature = JSON.stringify(body)
    if (last.current?.body !== signature)
      last.current = { body: signature, key: crypto.randomUUID() }
    try {
      const result = await (
        await adminTagRequest("/actions", {
          method: "POST",
          body: JSON.stringify({ ...body, request_id: last.current.key }),
        })
      ).json()
      last.current = null
      if (body.action === "issue" && result.batch_id) {
        setOffset(0)
        setBatch(result.batch_id)
        setLabel("")
      }
      setRevision((v) => v + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function downloadTag(code: string) {
    setBusy(true)
    try {
      const qr = await adminTagRequest("/qr?code=" + code)
      download(await qr.blob(), "event-tag-" + code.slice(0, 8) + ".png")
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function printSheet() {
    const frame = document.createElement("iframe")
    frame.title = "Printable event tags"
    frame.style.cssText =
      "position:fixed;left:-10000px;width:210mm;height:297mm"
    document.body.appendChild(frame)
    const doc = frame.contentDocument!,
      urls: string[] = []
    const cleanup = () => {
      urls.forEach(URL.revokeObjectURL)
      frame.remove()
    }
    setBusy(true)
    try {
      const style = doc.createElement("style")
      style.textContent =
        "@page{size:A4;margin:10mm}body{font:12px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:2mm}figure{margin:0;text-align:center;border:1px solid #bbb;padding:2mm;break-inside:avoid}img{width:32mm;height:32mm}figcaption{font-weight:bold}"
      doc.head.append(style)
      for (const tag of tags) {
        const blob = await (
          await adminTagRequest("/qr?code=" + tag.code)
        ).blob()
        const url = URL.createObjectURL(blob)
        urls.push(url)
        const figure = doc.createElement("figure"),
          image = doc.createElement("img"),
          caption = doc.createElement("figcaption")
        image.src = url
        caption.textContent =
          "E-Balik event check-in · " + tag.code.slice(0, 8).toUpperCase()
        figure.append(image, caption)
        doc.body.append(figure)
        await image.decode()
      }
      frame.contentWindow!.addEventListener("afterprint", cleanup, {
        once: true,
      })
      frame.contentWindow!.focus()
      frame.contentWindow!.print()
    } catch (e) {
      cleanup()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const releasable = tags.filter(t => !!event && t.allocation?.event_id === event && !t.held)
  const available = tags.filter((t) => !t.allocation && !t.disabled && !t.held)
  return (
    <section className="ets-panel">
      <header>
        <h3>{event ? "Event tag allocation" : "Reusable event QR batches"}</h3>
        <button onClick={() => setRevision((v) => v + 1)} disabled={busy}>
          Refresh
        </button>
      </header>
      {event && (
        <p>
          Check-in uses the venue and collection instructions saved in this
          event. Confirm the desk is staffed before opening.
        </p>
      )}
      {event && (
        <button
          disabled={!loaded || busy || (mode !== "on" && !desk.enabled)}
          onClick={() =>
            void mutate({
              action: "desk",
              event_id: event,
              enabled: !desk.enabled,
              version: desk.version,
            })
          }
        >
          {desk.enabled ? "Pause check-in" : "Open check-in"}
        </button>
      )}
      {!event && mode === "on" && (
        <form
          className="ets-controls"
          onSubmit={(e) => {
            e.preventDefault()
            void mutate({ action: "issue", label, count })
          }}
        >
          <label>
            Batch name
            <input
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            QR tags
            <input
              required
              type="number"
              min={1}
              max={100}
              value={count || ""}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button disabled={busy}>Generate event QR batch</button>
        </form>
      )}
      <label>
        Event batch
        <select
          value={batch}
          disabled={busy}
          onChange={(e) => setBatch(e.target.value)}
        >
          <option value="">Select a batch</option>
          {batches.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {b.label} · {b.batch_id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {(offset > 0 || batches.length === 25) && (
        <footer>
          <button
            disabled={busy || !offset}
            onClick={() => {
              setBatch("")
              setOffset((v) => v - 25)
            }}
          >
            Previous batches
          </button>
          <button
            disabled={busy || batches.length < 25}
            onClick={() => {
              setBatch("")
              setOffset((v) => v + 25)
            }}
          >
            Next batches
          </button>
        </footer>
      )}
      {tags.length > 0 && (
        <>
          <p>
            {tags.length} issued · {available.length} available ·{" "}
            {tags.filter((t) => t.held).length} unresolved
          </p>
          {event && available.length > 0 && mode === "on" && (
            <button
              disabled={busy}
              onClick={() =>
                void mutate({
                  action: "assign_batch",
                  event_id: event,
                  batch_id: batch,
                  tags: available.map((t) => ({
                    code: t.code,
                    version: t.version,
                  })),
                })
              }
            >
              Assign {available.length} available to this event
            </button>
          )}
          {event && releasable.length > 0 && <button disabled={busy} onClick={() => void mutate({
            action: "unassign_batch", event_id: event, batch_id: batch,
            tags: releasable.map(t => ({code: t.code, version: t.version}))
          })}>Release {releasable.length} unused allocations</button>}
          {!event && (
            <footer>
              <button
                disabled={busy || !printable}
                onClick={() => void printSheet()}
              >
                Print QR sheet
              </button>
              <button
                disabled={!printable}
                onClick={() =>
                  download(
                    new Blob(
                      [
                        "Tag code,Event check-in URL\r\n" +
                          tags.map((t) => t.code + "," + t.url).join("\r\n"),
                      ],
                      { type: "text/csv" },
                    ),
                    "event-tags-" + batch + ".csv",
                  )
                }
              >
                Download URLs
              </button>
            </footer>
          )}
          {warning && <p role="status">{warning}</p>}
          <div
            className="ets-scroll"
            tabIndex={0}
            aria-label="Event batch inventory"
          >
            <table>
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Allocation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.code}>
                    <td>{t.code.slice(0, 8).toUpperCase()}
                      {!event && <button type="button" disabled={busy || !printable} onClick={() => void downloadTag(t.code)}>Download QR</button>}
                    </td>
                    <td>
                      {t.allocation?.event_workspaces.name || "Unassigned"} ·{" "}
                      {t.held || (t.disabled ? "Disabled" : "Available")}
                    </td>
                    <td>
                      {event &&
                        (!t.allocation || t.allocation.event_id === event) && (
                          <button
                            disabled={
                              busy ||
                              !!t.held ||
                              (!t.allocation && (mode !== "on" || t.disabled))
                            }
                            onClick={() =>
                              void mutate({
                                action: t.allocation ? "unassign" : "assign",
                                event_id: event,
                                code: t.code,
                                version: t.version,
                              })
                            }
                          >
                            {t.allocation ? "Release allocation" : "Assign"}
                          </button>
                        )}
                      {!event && (
                        <button
                          disabled={busy || !!t.held}
                          onClick={() =>
                            void mutate({
                              action: t.disabled ? "enable" : "disable",
                              code: t.code,
                              event_id: t.allocation?.event_id,
                              version: t.version,
                            })
                          }
                        >
                          {t.disabled ? "Enable" : "Disable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {event && (
        <EventStorageItems
          request={adminTagRequest}
          event={event}
          mode={mode}
          scope="staff"
          title="Event custody register"
        />
      )}
    </section>
  )
}
export function WorkspaceEventTags({ event }: { event: string }) {
  const mode = useEventTagMode(adminTagRequest),
    [open, setOpen] = useState(false)
  return mode === "off" ? null : (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={BTN.ghost}>Event tags and custody</summary>
      {open && <Inventory key={event} event={event} mode={mode} />}
    </details>
  )
}
export function EventBatchPurpose({ personal }: { personal: () => void }) {
  const mode = useEventTagMode(adminTagRequest),
    [purpose, setPurpose] = useState("personal"),
    [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {mode !== "off" && (
          <select
            aria-label="Batch purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className={BTN.ghost}
          >
            <option value="personal">Personal tags</option>
            <option value="event">Reusable event tags</option>
          </select>
        )}
        {mode === "off" || purpose === "personal" ? (
          <button type="button" className={BTN.primary} onClick={personal}>
            Generate batch
          </button>
        ) : (
          <button
            type="button"
            className={BTN.primary}
            onClick={() => setOpen(true)}
          >
            Open event inventory
          </button>
        )}
      </div>
      {open && purpose === "event" && mode !== "off" && (
        <AdminModal title="Event QR inventory" onClose={() => setOpen(false)}>
          <Inventory mode={mode} />
        </AdminModal>
      )}
    </>
  )
}
