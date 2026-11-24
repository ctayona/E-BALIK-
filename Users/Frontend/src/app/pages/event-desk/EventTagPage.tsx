import { useEffect, useRef, useState } from "react"
import AuthOverlay from "@/app/shared/tags/AuthOverlay"
import LivePhotoField from "@/app/shared/tags/LivePhotoField"
import EventStorageItems from "../../../../../../shared/EventStorageItems"
import { json, useEventSession } from "./eventApi"
import { tagRequest } from "./EventTagItems"

interface Scan {
  event_id: string
  allocation_id: string
  version: number
  name: string
  venue: string
  desk_instructions: string
}
export default function EventTagPage({
  code,
  registration,
}: {
  code?: string
  registration?: string
}) {
  const token = useEventSession(),
    [auth, setAuth] = useState(false),
    [scan, setScan] = useState<Scan | null>(null)
  const [photo, setPhoto] = useState<File | null>(null),
    [name, setName] = useState(""),
    [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0)
  const key = useRef(crypto.randomUUID())
  useEffect(() => {
    if (!code) return
    const c = new AbortController()
    setScan(null)
    setError("")
    json<Scan>("/event-tags/scan/" + code, { signal: c.signal }, false)
      .then((v) => {
        if (!c.signal.aborted) setScan(v)
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
    return () => c.abort()
  }, [code, revision])
  async function register() {
    if (!photo || !scan || busy) return
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      form.set("photo", photo)
      form.set(
        "payload",
        JSON.stringify({
          request_id: key.current,
          code,
          event_id: scan.event_id,
          allocation_id: scan.allocation_id,
          version: scan.version,
          item_name: name,
          description: details,
        }),
      )
      const result = await json<{ registration_id: string }>(
        "/event-tags/register",
        { method: "POST", body: form },
      )
      window.location.replace("/event-items/" + result.registration_id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-3 py-6 sm:p-8">
      <nav>
        <a href="/">E-Balik</a> / Event items
      </nav>
      <section className="ets-panel">
        <h1 className="text-2xl font-bold">
          {registration
            ? "My checked-in item"
            : scan?.name || "Event item check-in"}
        </h1>
        {scan && (
          <>
            <p>
              {scan.venue} · {scan.desk_instructions}
            </p>
            <p>Keep your item until staff confirm physical receipt.</p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {!token && (registration || scan) && (
          <button onClick={() => setAuth(true)}>
            Sign in or create an account
          </button>
        )}
        {auth && (
          <AuthOverlay
            onClose={() => setAuth(false)}
            onSignedIn={() => {
              setAuth(false)
              setRevision((v) => v + 1)
            }}
          />
        )}
        {code && !scan && (
          <button onClick={() => setRevision((v) => v + 1)}>
            Check availability
          </button>
        )}
        {code && scan && token && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void register()
            }}
          >
            <label>
              Item type or name
              <input
                required
                minLength={3}
                maxLength={100}
                placeholder="Water bottle"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Identifying details
              <textarea
                required
                maxLength={500}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <LivePhotoField
              eventStorage
              required
              file={photo}
              onChange={setPhoto}
              label="Live photo of your item"
            />
            <button type="submit" disabled={!photo || busy}>
              {busy ? "Saving…" : "Request check-in"}
            </button>
          </form>
        )}
      </section>
      {token && registration && (
        <EventStorageItems
          request={tagRequest}
          scope="mine"
          registration={registration}
          title="Registration and receipt"
          mode="recovery"
        />
      )}
      {code && <a href="/event-items">My checked-in items</a>}
      {token && !registration && !code && (
        <EventStorageItems
          request={tagRequest}
          scope="mine"
          title="My checked-in items"
          mode="recovery"
        />
      )}
      {!token && !registration && !code && (
        <button onClick={() => setAuth(true)}>
          Sign in to view your items
        </button>
      )}
    </main>
  )
}
