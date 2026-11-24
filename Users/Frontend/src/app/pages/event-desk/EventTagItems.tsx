import { useState } from "react"
import EventStorageItems, {
  useEventTagMode,
  type Scope,
  type EventTagRequest,
} from "../../../../../../shared/EventStorageItems"
import { response } from "./eventApi"

export const tagRequest: EventTagRequest = (path, init) => {
  const [section, query = ""] = path.split("?")
  if (section === "/photo" || section === "/history") {
    const params = new URLSearchParams(query)
    return response(
      "/event-tags/items/" +
        encodeURIComponent(params.get("registration") || "") +
        section +
        "?offset=" +
        (params.get("offset") || "0"),
      init,
    )
  }
  return response("/event-tags" + path, init)
}
export default function EventTagItems({
  scope,
  event,
  title,
}: {
  scope: Scope
  event?: string
  title: string
}) {
  const mode = useEventTagMode(tagRequest)
  const [open, setOpen] = useState(false)
  if (mode === "off") return null
  return (
    <details
      className="ets-panel"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && (
        <EventStorageItems
          request={tagRequest}
          scope={scope}
          event={event}
          title={title}
          mode={mode}
        />
      )}
    </details>
  )
}
