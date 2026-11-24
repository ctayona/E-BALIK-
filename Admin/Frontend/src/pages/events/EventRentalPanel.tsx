import { useEffect, useRef, useState } from "react"
import AdminModal from "../../components/ui/AdminModal"
import { BTN, INPUT } from "../../components/ui/primitives"
import { API_URL, getAuthHeaders } from "../../utils/api"
import { peso } from "../../utils/incomeApi"
import {
  ConfirmPaymentModal,
  ReceiptModal,
  ReverseModal,
  type PayableItem,
} from "../income/PaymentModals"
import { findEventPerson } from "./eventsApi"

type Package = {
  package_id: string
  name: string
  price: string
  included_tags: number
  duration_hours: number
  support: string
  terms: string
  active: boolean
  version: number
}
type Booking = {
  booking_id: string
  amount: string
  status: string
  payer_id: string
  version: number
  quote: Package
  starts_at: string
  ends_at: string
}
type Workspace = { packages: Package[]; bookings: Booking[] }
const empty = {
  name: "",
  price: "",
  included_tags: 0,
  duration_hours: 24,
  support: "",
  terms: "",
  active: true,
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const reply = await fetch(API_URL + "/api/admin/events/" + path, {
    headers: getAuthHeaders(),
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  })
  const data = await reply.json()
  if (!reply.ok) throw Error(data.error || "Unable to load event billing.")
  return data
}

export default function EventRentalPanel({ event }: { event: string }) {
  const [enabled, setEnabled] = useState(false)
  const [data, setData] = useState<Workspace>({ packages: [], bookings: [] })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<typeof empty & {
    package_id?: string
    version?: number
  } | null>(null)
  const [booking, setBooking] = useState(false)
  const [selected, setSelected] = useState("")
  const [email, setEmail] = useState("")
  const [note, setNote] = useState("")
  const [paying, setPaying] = useState<PayableItem | null>(null)
  const [receipt, setReceipt] = useState("")
  const [refund, setRefund] = useState<{ id: string; amount: number } | null>(
    null,
  )
  const pending = useRef<{ signature: string; id: string } | null>(null)
  async function load() {
    try {
      const capability = await request<{ enabled: boolean }>(
        "rentals/capability",
      )
      setEnabled(capability.enabled)
      if (capability.enabled)
        setData(await request<Workspace>(event + "/rentals"))
    } catch (failure) {
      setError((failure as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [event])
  async function action(kind: string, details: unknown) {
    const signature = JSON.stringify({ kind, details })
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() }
    await request("rentals/actions", {
      action: kind,
      data: details,
      request_id: pending.current.id,
    })
    pending.current = null
    await load()
  }
  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    await run(async () => {
      if (form) {
        await action("package", form)
        setForm(null)
      } else {
        const person = await findEventPerson(event, email)
        const pkg = data.packages.find((p) => p.package_id === selected)!
        await action("book", {
          event_id: event,
          package_id: selected,
          package_version: pkg.version,
          payer_id: person.account_id,
          note,
        })
        setBooking(false)
      }
    })
  }
  async function paymentEntry(id: string) {
    // The rental endpoint supplies the precise sale reference independently of the ledger page.
    const reply = await request<{ entry_id: string; amount: number }>(
      event + "/rentals/receipt?booking=" + encodeURIComponent(id),
    )
    return reply
  }
  if (!enabled)
    return error ? (
      <p role="alert" className="event-review-error">
        {error}
      </p>
    ) : null
  return (
    <details className="event-history">
      <summary>Rental booking and billing</summary>
      <p className="event-panel-note">
        One full payment per booking. Included reusable event tags are bundled
        into the quoted price. Each booking preserves its package and schedule.
        Recovery and custody continue independently.
      </p>
      <div className="flex flex-wrap gap-2 my-3">
        <button
          className={BTN.ghost}
          disabled={busy}
          onClick={() => {
            setForm({ ...empty })
            setError("")
          }}
        >
          New package
        </button>
        <button
          className={BTN.primary}
          disabled={busy || !data.packages.some((p) => p.active)}
          onClick={() => {
            setBooking(true)
            setSelected("")
            setNote("")
            setEmail("")
          }}
        >
          Create booking
        </button>
        <button
          className={BTN.ghost}
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="event-review-error">
          {error}
        </p>
      )}
      <div className="max-h-80 overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[620px] text-sm">
          <caption className="sr-only">Event bookings</caption>
          <thead>
            <tr>
              <th className="p-3 text-left">Package</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.bookings.map((b) => (
              <tr key={b.booking_id} className="border-t border-line">
                <td className="p-3">
                  <strong>{b.quote.name}</strong>
                  <p>
                    {b.quote.included_tags} tags · {b.quote.duration_hours}{" "}
                    hours
                  </p>
                  <p className="max-w-xs whitespace-pre-wrap">
                    {b.quote.terms}
                  </p>
                  <details className="mt-2">
                    <summary>Agreed service</summary>
                    <p className="max-w-xs whitespace-pre-wrap">
                      {b.quote.support}
                    </p>
                    <p>
                      {new Date(b.starts_at).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                      })}{" "}
                      –{" "}
                      {new Date(b.ends_at).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                      })}{" "}
                      · Manila
                    </p>
                  </details>
                </td>
                <td>{b.status.replaceAll("_", " ")}</td>
                <td>{peso(Number(b.amount))}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {b.status === "awaiting_payment" && (
                      <button
                        className={BTN.gold}
                        onClick={() =>
                          setPaying({
                            source: "event_rental",
                            source_ref: b.booking_id,
                            title: b.quote.name,
                            amount: Number(b.amount),
                            payer_name: email,
                          })
                        }
                      >
                        Confirm payment
                      </button>
                    )}
                    {["awaiting_payment", "complimentary"].includes(
                      b.status,
                    ) && (
                      <button
                        className={BTN.ghost}
                        onClick={() => {
                          setSelected(b.booking_id)
                          setNote("")
                        }}
                      >
                        Cancel booking
                      </button>
                    )}
                    {["paid", "refunded"].includes(b.status) && (
                      <button
                        className={BTN.ghost}
                        onClick={() =>
                          void run(async () => {
                            setReceipt(
                              (await paymentEntry(b.booking_id)).entry_id,
                            )
                          })
                        }
                      >
                        Receipt
                      </button>
                    )}
                    {b.status === "paid" && (
                      <button
                        className={BTN.ghost}
                        onClick={() =>
                          void run(async () => {
                            const entry = await paymentEntry(b.booking_id)
                            setRefund({
                              id: entry.entry_id,
                              amount: Number(b.amount),
                            })
                          })
                        }
                      >
                        Refund
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.bookings.length && (
          <p className="p-4 text-ink-muted">
            No rental booking for this event.
          </p>
        )}
      </div>
      <details className="mt-4">
        <summary>Manage packages</summary>
        <div className="max-h-60 overflow-auto space-y-2 p-2">
          {data.packages.map((p) => (
            <button
              key={p.package_id}
              className={BTN.ghost}
              onClick={() => {
                setForm({ ...p })
                setError("")
              }}
            >
              {p.name} · {peso(Number(p.price))} ·{" "}
              {p.active ? "Available" : "Retired"}
            </button>
          ))}
        </div>
      </details>
      {(form || booking) && (
        <AdminModal
          title={form ? "Rental package" : "Create rental booking"}
          description="Save the agreed package and organizer account."
          busy={busy}
          onClose={() => {
            setForm(null)
            setBooking(false)
          }}
          footer={
            <>
              <button
                className={BTN.ghost}
                disabled={busy}
                onClick={() => {
                  setForm(null)
                  setBooking(false)
                }}
              >
                Cancel
              </button>
              <button
                className={BTN.primary}
                disabled={
                  busy ||
                  (!form &&
                    (!selected || !email.trim() || note.trim().length < 8))
                }
                onClick={() => void save()}
              >
                Save
              </button>
            </>
          }
        >
          <fieldset disabled={busy} className="space-y-4">
            {form ? (
              <>
                <label className="block">
                  Package name
                  <input
                    className={INPUT}
                    maxLength={100}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className="block">
                  Full price in pesos
                  <input
                    className={INPUT}
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  Included reusable tags
                  <input
                    className={INPUT}
                    type="number"
                    min={0}
                    max={10000}
                    value={form.included_tags}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        included_tags: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="block">
                  Maximum event hours
                  <input
                    className={INPUT}
                    type="number"
                    min={1}
                    max={8760}
                    value={form.duration_hours}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        duration_hours: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="block">
                  Support included
                  <textarea
                    className={INPUT}
                    maxLength={500}
                    value={form.support}
                    onChange={(e) =>
                      setForm({ ...form, support: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  Agreed service and cancellation terms
                  <textarea
                    className={INPUT}
                    maxLength={1000}
                    value={form.terms}
                    onChange={(e) =>
                      setForm({ ...form, terms: e.target.value })
                    }
                  />
                </label>
                {form.package_id && (
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) =>
                        setForm({ ...form, active: e.target.checked })
                      }
                    />
                    Available for new bookings
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="block">
                  Package
                  <select
                    className={INPUT}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Choose a package</option>
                    {data.packages
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.package_id} value={p.package_id}>
                          {p.name} · {peso(Number(p.price))}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  Organizer E-Balik account email
                  <input
                    className={INPUT}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block">
                  Agreement reference or complimentary authorization
                  <textarea
                    className={INPUT}
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="event-review-error">
                {error}
              </p>
            )}
          </fieldset>
        </AdminModal>
      )}
      {selected &&
        !booking &&
        !form &&
        data.bookings.some((b) => b.booking_id === selected) && (
          <AdminModal
            title="Cancel booking"
            busy={busy}
            onClose={() => setSelected("")}
            footer={
              <button
                className={BTN.primary}
                disabled={busy || note.trim().length < 8}
                onClick={() =>
                  void run(async () => {
                    await action("cancel", {
                      booking_id: selected,
                      version: data.bookings.find(
                        (b) => b.booking_id === selected,
                      )?.version,
                      note,
                    })
                    setSelected("")
                  })
                }
              >
                Confirm cancellation
              </button>
            }
          >
            <label>
              Reason
              <textarea
                className={INPUT}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
          </AdminModal>
        )}
      {paying && (
        <ConfirmPaymentModal
          item={paying}
          onClose={() => {
            setPaying(null)
            void load()
          }}
          onConfirmed={() => void load()}
        />
      )}
      {receipt && (
        <ReceiptModal
          kind="payment"
          id={receipt}
          onClose={() => setReceipt("")}
        />
      )}
      {refund && (
        <ReverseModal
          entryId={refund.id}
          amount={refund.amount}
          receiptNo=""
          onClose={() => setRefund(null)}
          onDone={() => {
            setRefund(null)
            void load()
          }}
        />
      )}
    </details>
  )
}
