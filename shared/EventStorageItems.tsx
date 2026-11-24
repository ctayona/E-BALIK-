import { useEffect, useRef, useState } from "react"
import "./eventStorage.css"

export type EventTagRequest = (
  path: string,
  init?: RequestInit,
) => Promise<Response>
export type Scope = "mine" | "staff" | "office"
interface Item {
  registration_id: string
  event_id: string
  event_name: string
  code: string
  item_name: string
  description: string
  status: string
  version: number
  created_at: string
  received_at: string | null
  released_at: string | null
  pin?: string
  receipt?: string
  storage?: string
  attendee?: string
  transfer?: boolean
  destination?: string
  recovery_consent: boolean
  report_id: string | null
}
type Log = { action: string; outcome: string; created_at: string }
const titles: Record<string, string> = {
  pending: "Awaiting staff receipt",
  held: "In custody",
  office: "At the university office",
  collected: "Collected",
  cancelled: "Cancelled",
}
const labels: Record<string, string> = {
  cancel: "Cancel pending check-in",
  receive: "Confirm physical receipt",
  collect: "Verify pickup",
  reset_pin: "Renew private PIN",
  consent: "Change recovery permission",
  transfer: "Request office handover",
  accept: "Accept office handover",
  cancel_transfer: "Cancel office handover",
  escalate: "Create recovery report",
  remind: "Send collection reminder",
}
const date = (v: string) =>
  new Date(v).toLocaleString("en-PH", { timeZone: "Asia/Manila" })
export function useEventTagMode(request: EventTagRequest, enabled = true) {
  const [mode, setMode] = useState("off")
  useEffect(() => {
    const c = new AbortController()
    setMode("off")
    if (enabled)
      request("/capability", { signal: c.signal })
        .then((r) => r.json())
        .then((v) => {
          if (!c.signal.aborted) setMode(v.mode)
        })
        .catch(() => {})
    return () => c.abort()
  }, [request, enabled])
  return mode
}

function Detail({
  item,
  role,
  request,
  onClose,
  onSaved,
  mode,
}: {
  item: Item
  role: string
  request: EventTagRequest
  onClose: () => void
  onSaved: (msg: string) => void
  mode: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const pending = useRef<{ signature: string; id: string } | null>(null)
  const [action, setAction] = useState("")
  const [history, setHistory] = useState<Log[]>([])
  const [more, setMore] = useState(true)
  const [photo, setPhoto] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const owner = role === "owner",
    manager = ["manager", "super_admin"].includes(role)
  const actions: string[] = []
  if (item.status === "pending") {
    if (owner || manager) actions.push("cancel")
    if (!owner && role !== "office" && mode === "on") actions.push("receive")
  }
  if (["held", "office"].includes(item.status)) {
    if (owner) {
      actions.push("reset_pin")
      if (!item.report_id) actions.push("consent")
    } else {
      if (
        (item.status === "held" && !item.transfer) ||
        (item.status === "office" &&
          (role === "office" || role === "super_admin"))
      )
        actions.push("collect")
      if (manager) {
        actions.push("remind")
        if (item.status === "held")
          actions.push(item.transfer ? "cancel_transfer" : "transfer")
        if (item.recovery_consent && !item.report_id) actions.push("escalate")
      }
      if (role === "office" && item.status === "held") actions.push("accept")
    }
  }
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  useEffect(() => {
    const c = new AbortController()
    let url = ""
    request("/photo?registration=" + item.registration_id, { signal: c.signal })
      .then((r) => r.blob())
      .then((b) => {
        if (!c.signal.aborted) {
          url = URL.createObjectURL(b)
          setPhoto(url)
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("Photo unavailable. Refresh before physical handover.")
      })
    return () => {
      c.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [request, item.registration_id])
  async function loadHistory() {
    setBusy(true)
    try {
      const data = await (
        await request(
          "/history?registration=" +
            item.registration_id +
            "&offset=" +
            history.length,
        )
      ).json()
      setHistory((v) => [...v, ...data.history])
      setMore(data.history.length === 24)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function submit(form: HTMLFormElement) {
    const fields = Object.fromEntries(new FormData(form))
    const data = {
      ...fields,
      action,
      event_id: item.event_id,
      code: item.code,
      registration_id: item.registration_id,
      version: item.version,
      allowed: !item.recovery_consent,
      identity_checked: fields.identity_checked === "on",
    }
    const signature = JSON.stringify(data)
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() }
    setBusy(true)
    setError("")
    try {
      const saved = await (
        await request("/actions", {
          method: "POST",
          body: JSON.stringify({ ...data, request_id: pending.current.id }),
        })
      ).json()
      onSaved(
        saved.emailed === false || saved.notified === false
          ? "Saved. One or more notifications could not be delivered."
          : "Event item updated.",
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={ref}
      className="ets-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault()
        else onClose()
      }}
    >
      <header>
        <h3>{item.item_name}</h3>
        <button type="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      <p>{item.event_name}</p>
      <p>
        <strong>{titles[item.status]}</strong> ·{" "}
        {item.code.slice(0, 8).toUpperCase()}
      </p>
      {photo && (
        <img className="ets-photo" src={photo} alt="Item at check-in" />
      )}
      <p>{item.description}</p>
      {item.attendee && <p>Attendee · {item.attendee}</p>}
      {!owner && item.storage && <p>Private storage · {item.storage}</p>}
      {item.destination && <p>Office destination · {item.destination}</p>}
      {item.received_at && <p>Received · {date(item.received_at)} Manila</p>}
      {owner && ["held", "office"].includes(item.status) && (
        <p>
          Private Handover PIN ·{" "}
          <strong>{item.pin || "Renew PIN to collect"}</strong>
        </p>
      )}
      {item.receipt && (
        <section>
          <h4>Collection receipt</h4>
          <p>{item.receipt}</p>
          <p>Verified pickup · {date(item.released_at!)} Manila</p>
          <button
            onClick={() => {
              const content = [
                "E-Balik · Event collection receipt",
                item.receipt,
                item.event_name,
                item.item_name,
                "Checked in: " + date(item.created_at) + " Manila",
                "Received: " + date(item.received_at!) + " Manila",
                "Collected: " + date(item.released_at!) + " Manila",
                "Private owner record: " +
                  window.location.origin +
                  "/event-items/" +
                  item.registration_id,
              ].join("\n")
              const url = URL.createObjectURL(
                new Blob([content], { type: "text/plain;charset=utf-8" }),
              )
              const a = document.createElement("a")
              a.href = url
              a.download = item.receipt + ".txt"
              a.click()
              setTimeout(() => URL.revokeObjectURL(url), 30000)
            }}
          >
            Download receipt
          </button>
        </section>
      )}
      {item.report_id && (
        <p>
          Event recovery report · EV-{item.report_id.slice(0, 8).toUpperCase()}
        </p>
      )}
      <ul>
        {history.map((h, i) => (
          <li key={i}>
            {date(h.created_at)} · {labels[h.action] || h.action} · {h.outcome}
          </li>
        ))}
      </ul>
      {more && (
        <button disabled={busy} onClick={() => void loadHistory()}>
          {history.length ? "More history" : "View custody history"}
        </button>
      )}
      {!!actions.length && (
        <form
          key={action}
          onSubmit={(e) => {
            e.preventDefault()
            void submit(e.currentTarget)
          }}
        >
          <label>
            Action
            <select
              value={action}
              disabled={busy}
              onChange={(e) => {
                setAction(e.target.value)
                setError("")
              }}
            >
              <option value="">Choose an action</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {labels[a]}
                </option>
              ))}
            </select>
          </label>
          {["receive", "accept"].includes(action) && (
            <label>
              Private shelf or bin
              <input name="storage" required maxLength={160} />
            </label>
          )}
          {action === "collect" && (
            <>
              <label>
                Attendee’s Handover PIN
                <input name="pin" autoComplete="off" required maxLength={32} />
              </label>
              <label>
                <input type="checkbox" name="identity_checked" required /> I
                checked the attendee’s identity and matched the physical item.
              </label>
            </>
          )}
          {action === "transfer" && (
            <>
              <label>
                Receiving staff email
                <input type="email" name="email" required />
              </label>
              <label>
                Destination office
                <input name="destination" maxLength={160} required />
              </label>
            </>
          )}
          {action === "consent" && (
            <p>
              {item.recovery_consent
                ? "Withdraw permission to create a recovery report."
                : "Allow the manager to open a missing-item report in your name and submit its generic listing for event moderation. Your photo and shelf stay private. Main-hub publication requires separate permission."}
            </p>
          )}
          {action === "escalate" && (
            <label>
              Recovery report description
              <textarea name="reason" required minLength={10} maxLength={500} />
            </label>
          )}
          {action && (
            <button
              disabled={
                busy ||
                ((action === "receive" || action === "collect") && !photo)
              }
              type="submit"
            >
              {busy ? "Saving…" : labels[action]}
            </button>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  )
}

export default function EventStorageItems({
  request,
  scope,
  event,
  registration,
  title,
  mode,
}: {
  request: EventTagRequest
  scope: Scope
  event?: string
  registration?: string
  title: string
  mode: string
}) {
  const [rows, setRows] = useState<Item[]>([]),
    [role, setRole] = useState("owner"),
    [more, setMore] = useState(false)
  const [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Item | null>(null)
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("")
  const [term, setTerm] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    setError("")
    setSelected(null)
    setRows([])
    const params = new URLSearchParams({
      scope,
      offset: String(offset),
      search: term,
      status,
    })
    if (event) params.set("event", event)
    if (registration) params.set("registration", registration)
    request("/items?" + params, { signal: c.signal })
      .then((r) => r.json())
      .then((v) => {
        if (!c.signal.aborted) {
          setRows(v.rows)
          setRole(v.role)
          setMore(v.more)
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [request, scope, event, registration, offset, revision, term, status])
  return (
    <section className="ets-panel">
      <header>
        <h3>{title}</h3>
        <button onClick={() => setRevision((v) => v + 1)}>Refresh</button>
      </header>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {scope !== "mine" && (
        <div className="ets-controls">
          <label>
            Search event items
            <input
              maxLength={160}
              placeholder="Tag code, scanned URL or item"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Custody status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setOffset(0)
              }}
            >
              <option value="">All items</option>
              {Object.entries(titles).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="ets-scroll" tabIndex={0} aria-label={title}>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Tag</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.registration_id}>
                <td>{r.item_name}</td>
                <td>{r.code.slice(0, 8).toUpperCase()}</td>
                <td>{titles[r.status]}</td>
                <td>
                  <button onClick={() => setSelected(r)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p role="status">Loading items…</p>
      ) : !error && !rows.length ? (
        <p>No check-ins on this page.</p>
      ) : null}
      {(offset > 0 || more) && (
        <footer>
          <button
            disabled={loading || !offset}
            onClick={() => setOffset((v) => v - 24)}
          >
            Previous
          </button>
          <button
            disabled={loading || !more}
            onClick={() => setOffset((v) => v + 24)}
          >
            Next
          </button>
        </footer>
      )}
      {selected && (
        <Detail
          item={selected}
          role={role}
          request={request}
          mode={mode}
          onClose={() => {
            setSelected(null)
            setRevision((v) => v + 1)
          }}
          onSaved={(msg) => {
            setMessage(msg)
            setRevision((v) => v + 1)
          }}
        />
      )}
    </section>
  )
}
