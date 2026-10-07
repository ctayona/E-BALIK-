import { useEffect, useMemo, useState } from "react";
import { Eye, ImagePlus, PackageCheck, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { createAdminFoundItem, deleteAdminFoundItem, fetchAdminFoundItems, updateAdminFoundItem, type AdminFoundItemRow } from "../../utils/api";
import { canDelete } from "../../utils/permissions";
import { useT, tr } from "../../utils/preferences";
import { downloadCsv } from "../../utils/csv";
import { CAMPUS_LOCATIONS, ITEM_CATEGORIES, categoryOptions, uniqueSorted } from "../../utils/itemOptions";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, PageHeader, RolePill, SelectInput, TextArea, TextInput } from "../../components/ui/primitives";
import { DataTable, DetailGrid, ExportButton, FilterSelect, IconAction, RowActions, SearchField, SegmentedFilter, StatusPill, TableFooter, Thumb, Toolbar, usePagination, type Tone } from "../../components/ui/management";

type FoundItem = AdminFoundItemRow;
type FoundStatus = FoundItem["status"];
type FoundForm = { item: string; description: string; category: string; locationFound: string; dateFound: string; storage: string; photo: string; status?: string };
type PendingAction =
  | { type: "save"; data: Partial<FoundForm>; reference?: string }
  | { type: "delete"; reference: string };

const STATUS_TONE: Record<FoundStatus, Tone> = {
  "Unclaimed": "gold",
  "Under Review": "iris",
  "Claimed": "mint",
  "Ready to Release": "mint",
  "Auctioned": "iris",
  "Released": "slate",
};

/** Holding states an admin may set directly. Claimed, ready-to-release and returned come from the claim workflow. */
const HOLDING_STATUSES = [
  { value: "unclaimed", label: "In storage, waiting for the owner" },
  { value: "review", label: "Under review (on hold)" },
];

const ALL = "__all__";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function FoundItemFormModal({ item, busy, onClose, onSubmit }: { item?: FoundItem; busy: boolean; onClose: () => void; onSubmit: (data: Partial<FoundForm>) => void }) {
  const editing = Boolean(item);
  const workflowOwnsStatus = Boolean(item?.rawStatus && !HOLDING_STATUSES.some((status) => status.value === item.rawStatus));
  const [form, setForm] = useState<FoundForm>({
    item: item?.item ?? "",
    description: item && item.description !== "No description" ? item.description : "",
    category: item?.category ?? ITEM_CATEGORIES[0],
    locationFound: item?.locationFound && item.locationFound !== "Unknown" ? item.locationFound : "",
    dateFound: item?.dateFound?.slice(0, 10) ?? "",
    storage: item?.storage && item.storage !== "Unknown" ? item.storage : "",
    photo: item?.photo ?? "",
    status: item?.rawStatus ?? "unclaimed",
  });
  const [error, setError] = useState("");
  const set = (key: keyof FoundForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const today = new Date().toISOString().slice(0, 10);

  const choosePhoto = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError(tr("Use a PNG or JPG photo."));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError(tr("The photo must be 10 MB or smaller."));
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () => set("photo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const required: [keyof FoundForm, string][] = [["item", tr("item name")], ["category", "category"], ["locationFound", tr("place found")], ["dateFound", tr("date found")], ["storage", tr("storage location")]];
    const missing = required.filter(([key]) => !String(form[key] ?? "").trim()).map(([, label]) => label);
    if (missing.length) {
      setError(tr("Add the {0} before saving.", { "0": missing.join(", ") }));
      return;
    }
    if (form.dateFound > today) {
      setError(tr("The date found can't be in the future."));
      return;
    }
    setError("");
    const data: Partial<FoundForm> = {
      item: form.item.trim(),
      description: form.description.trim(),
      category: form.category,
      locationFound: form.locationFound.trim(),
      dateFound: form.dateFound,
      storage: form.storage.trim(),
    };
    // Only send the photo when it changed, so edits don't re-upload the stored image.
    if (form.photo && form.photo !== item?.photo) data.photo = form.photo;
    if (editing && !workflowOwnsStatus && form.status !== item?.rawStatus) data.status = form.status;
    onSubmit(data);
  };

  return (
    <AdminModal
      title={editing ? tr("Edit {0}", { "0": item?.id }) : tr("Register a found item")}
      description={editing ? tr("Update the record and where the item is stored.") : tr("Log an item turned over to the Lost and Found Office. It's matched against open lost reports.")}
      icon={editing ? <Pencil size={19} /> : <PackageCheck size={20} />}
      tone={editing ? "navy" : "gold"}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="submit" form="found-item-form" disabled={busy} className={editing ? BTN.primary : BTN.gold}>{editing ? tr("Save changes") : tr("Register item")}</button>
      </>}
    >
      <form id="found-item-form" onSubmit={submit} className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]" noValidate>
        <div>
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Photo")}</span>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); choosePhoto(e.dataTransfer.files[0]); }}
            className="group relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line-strong bg-frost-50 text-center transition-colors hover:border-gold-400"
          >
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => choosePhoto(e.target.files?.[0])} />
            {form.photo ? (
              <>
                <img decoding="async" src={form.photo} alt={tr("Found item preview")} className="absolute inset-0 size-full object-cover" />
                <span className="absolute inset-x-2 bottom-2 rounded-xl bg-navy-950/70 px-2 py-1.5 text-[12.5px] font-semibold text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">{tr("Replace photo")}</span>
              </>
            ) : (
              <>
                <ImagePlus size={26} className="mb-2 text-ink-muted" aria-hidden="true" />
                <span className="px-4 text-[13.5px] font-medium text-ink-soft">{tr("Drop a photo or click to upload")}</span>
                <span className="mt-1 text-[12.5px] text-ink-muted">{tr("PNG or JPG, up to 10 MB")}</span>
              </>
            )}
          </label>
        </div>
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <Field label={tr("Item name")} required>{(id) => <TextInput id={id} data-autofocus value={form.item} onChange={(e) => set("item", e.target.value)} maxLength={255} placeholder={tr("Silver Casio watch")} />}</Field>
          <Field label={tr("Category")} required>{(id) => (
            <SelectInput id={id} value={form.category} onChange={(e) => set("category", e.target.value)}>
              {categoryOptions(item?.category).map((category) => <option key={category}>{category}</option>)}
            </SelectInput>
          )}</Field>
          <div className="sm:col-span-2">
            <Field label={tr("Description")} hint={tr("Visible condition and marks. Leave out details only the owner should know.")}>{(id) => <TextArea id={id} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />}</Field>
          </div>
          <Field label={tr("Found at")} required>{(id) => (
            <>
              <TextInput id={id} list="found-location-options" value={form.locationFound} onChange={(e) => set("locationFound", e.target.value)} maxLength={255} placeholder={tr("Cafeteria, near the stairs")} />
              <datalist id="found-location-options">{CAMPUS_LOCATIONS.map((location) => <option key={location} value={location} />)}</datalist>
            </>
          )}</Field>
          <Field label={tr("Date found")} required>{(id) => <TextInput id={id} type="date" max={today} value={form.dateFound} onChange={(e) => set("dateFound", e.target.value)} />}</Field>
          <div className="sm:col-span-2">
            <Field label={tr("Storage location")} required>{(id) => <TextInput id={id} value={form.storage} onChange={(e) => set("storage", e.target.value)} maxLength={255} placeholder={tr("Admin locker A-12")} />}</Field>
          </div>
          {editing && (
            <div className="sm:col-span-2">
              <Field label={tr("Holding status")} hint={workflowOwnsStatus ? tr("This item is {0}. The claim workflow manages its status from here.", { "0": item?.status.toLowerCase() }) : tr("Put an item on hold while ownership is being checked.")}>{(id) => (
                <SelectInput id={id} value={workflowOwnsStatus ? "" : form.status} disabled={workflowOwnsStatus} onChange={(e) => set("status", e.target.value)}>
                  {workflowOwnsStatus && <option value="">{item?.status}</option>}
                  {HOLDING_STATUSES.map((status) => <option key={status.value} value={status.value}>{tr(status.label)}</option>)}
                </SelectInput>
              )}</Field>
            </div>
          )}
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 md:col-span-2">{error}</p>}
      </form>
    </AdminModal>
  );
}

export default function FoundItems() {
  const t = useT();
  const [items, setItems] = useState<FoundItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [category, setCategory] = useState(ALL);
  const [formItem, setFormItem] = useState<{ item?: FoundItem } | null>(null);
  const [viewItem, setViewItem] = useState<FoundItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isSuperAdmin = canDelete();

  useEffect(() => {
    let active = true;
    localStorage.removeItem("e-balik-found-items"); // retired cache, nothing reads it
    fetchAdminFoundItems()
      .then((data) => { if (active) setItems(data); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const statusCounts = useMemo(() => items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {}), [items]);
  const categories = useMemo(() => uniqueSorted([...ITEM_CATEGORIES, ...items.map((item) => item.category)]), [items]);
  const inCustody = items.filter((item) => item.status !== "Released").length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== ALL && item.status !== statusFilter) return false;
      if (category !== ALL && item.category !== category) return false;
      return !query || [item.item, item.id, item.locationFound, item.storage, item.description].some((value) => value?.toLowerCase().includes(query));
    });
  }, [items, search, statusFilter, category]);
  const paging = usePagination(filtered, 12, `${search}|${statusFilter}|${category}`);
  const hasFilters = Boolean(search) || statusFilter !== ALL || category !== ALL;

  const confirmPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    try {
      if (pendingAction.type === "delete") {
        await deleteAdminFoundItem(pendingAction.reference);
        setViewItem(null);
      } else if (pendingAction.reference) {
        await updateAdminFoundItem(pendingAction.reference, pendingAction.data);
      } else {
        await createAdminFoundItem(pendingAction.data);
      }
      setItems(await fetchAdminFoundItems());
      if (pendingAction.type === "save") setFormItem(null);
    } catch {
      // adminItemMutation already reported the server's reason in the global result modal.
    } finally {
      setPendingAction(null);
      setActionBusy(false);
    }
  };

  const exportCsv = () => downloadCsv("found-items", ["Reference", "Item", "Category", "Description", "Found at", "Date found", "Storage", "Status", "AI match"],
    filtered.map((item) => [item.id, item.item, item.category, item.description, item.locationFound, item.dateFound, item.storage, item.status, item.aiPercent ? `${item.aiPercent}%` : ""]));

  if (loading) {
    return <div className="space-y-5 p-4 sm:p-6" aria-busy="true"><div><SkeletonBlock className="mb-2 h-8 w-56" /><SkeletonBlock className="h-4 w-80" /></div><SkeletonBlock className="h-14 w-full rounded-2xl" /><AdminTableSkeleton columns={8} rows={7} /></div>;
  }

  const statusTabs = [
    { value: ALL, label: t("common.allStatuses"), count: items.length },
    ...(["Unclaimed", "Under Review", "Claimed", "Ready to Release", "Auctioned", "Released"] as FoundStatus[])
      .filter((status) => statusCounts[status])
      .map((status) => ({ value: status, label: status, count: statusCounts[status] })),
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("found.title")}
        description={t("found.description", { count: inCustody })}
        meta={<RolePill superAdmin={isSuperAdmin} />}
        actions={<>
          <ExportButton onClick={exportCsv} disabled={!filtered.length} />
          <button type="button" onClick={() => setFormItem({})} className={BTN.primary}><Plus size={17} aria-hidden="true" />{t("found.add")}</button>
        </>}
      />

      <SegmentedFilter label={t("common.status")} value={statusFilter} onChange={setStatusFilter} options={statusTabs} />

      <Toolbar trailing={hasFilters ? <button type="button" onClick={() => { setSearch(""); setStatusFilter(ALL); setCategory(ALL); }} className={BTN.ghost}>{t("common.clearFilters")}</button> : undefined}>
        <SearchField value={search} onChange={setSearch} placeholder={t("found.search")} />
        <FilterSelect label={t("found.col.category")} value={category} onChange={setCategory} options={[{ value: ALL, label: t("common.allCategories") }, ...categories.map((value) => ({ value, label: value }))]} />
      </Toolbar>

      <DataTable
        caption={t("found.title")}
        columns={[
          { key: "ref", label: t("found.col.reference") },
          { key: "item", label: t("found.col.item") },
          { key: "category", label: t("found.col.category") },
          { key: "location", label: t("found.col.location") },
          { key: "date", label: t("found.col.date") },
          { key: "storage", label: t("found.col.storage") },
          { key: "status", label: t("common.status") },
          { key: "actions", label: t("common.actions") },
        ]}
        isEmpty={paging.pageItems.length === 0}
        empty={items.length === 0 ? t("found.empty") : t("common.noMatches")}
        footer={<TableFooter {...paging} onPage={paging.setPage} />}
      >
        {paging.pageItems.map((item) => (
          <tr key={item.id} data-tone={STATUS_TONE[item.status]}>
            <td className="whitespace-nowrap font-semibold text-ink">{item.id}</td>
            <td>
              <div className="flex min-w-[220px] max-w-[320px] items-center gap-3">
                <Thumb src={item.photo} alt={tr("{0} photo", { "0": item.item })} />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{item.item}</div>
                  <div className="flex items-center gap-1.5 truncate text-[13px] text-ink-muted">
                    {item.aiPercent ? <><Sparkles size={13} className="shrink-0 text-gold-500" aria-hidden="true" /><span className="truncate">{item.aiPercent}% match{item.matchedItem ? tr(" with {0}", { "0": item.matchedItem }) : ""}</span></> : <span className="truncate" title={item.description}>{item.description}</span>}
                  </div>
                </div>
              </div>
            </td>
            <td className="whitespace-nowrap">{item.category}</td>
            <td><div className="max-w-[180px] truncate" title={item.locationFound}>{item.locationFound}</div></td>
            <td className="whitespace-nowrap">{item.dateFound?.slice(0, 10) || "—"}</td>
            <td><div className="max-w-[160px] truncate" title={item.storage}>{item.storage}</div></td>
            <td><StatusPill tone={STATUS_TONE[item.status]}>{item.status}</StatusPill></td>
            <RowActions>
              <IconAction label={`${t("common.view")} ${item.id}`} onClick={() => setViewItem(item)} icon={<Eye size={17} aria-hidden="true" />} />
              <IconAction label={`${t("common.edit")} ${item.id}`} tone="gold" onClick={() => setFormItem({ item })} icon={<Pencil size={16} aria-hidden="true" />} />
              {isSuperAdmin && <IconAction label={`${t("common.delete")} ${item.id}`} tone="danger" onClick={() => setPendingAction({ type: "delete", reference: item.id })} icon={<Trash2 size={16} aria-hidden="true" />} />}
            </RowActions>
          </tr>
        ))}
      </DataTable>

      {viewItem && (
        <AdminModal
          title={viewItem.item}
          description={tr("Found item {0}, stored at {1}", { "0": viewItem.id, "1": viewItem.storage })}
          icon={<PackageCheck size={20} />}
          size="lg"
          onClose={() => setViewItem(null)}
          footer={<>
            {isSuperAdmin && <button type="button" onClick={() => setPendingAction({ type: "delete", reference: viewItem.id })} className={`${BTN.ghost} sm:mr-auto`}><Trash2 size={16} aria-hidden="true" />{t("common.delete")}</button>}
            <button type="button" onClick={() => setViewItem(null)} className={BTN.ghost}>{t("common.close")}</button>
            <button type="button" onClick={() => { setFormItem({ item: viewItem }); setViewItem(null); }} className={BTN.primary}><Pencil size={16} aria-hidden="true" />{t("common.edit")}</button>
          </>}
        >
          <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
            {viewItem.photo ? (
              <img decoding="async" src={viewItem.photo} alt={tr("{0} photo", { "0": viewItem.item })} className="aspect-square w-full rounded-2xl object-cover ring-1 ring-line" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-frost-100 text-[13px] text-ink-muted ring-1 ring-line">{tr("No photo")}</div>
            )}
            <div className="space-y-3">
              <StatusPill tone={STATUS_TONE[viewItem.status]}>{viewItem.status}</StatusPill>
              <DetailGrid items={[
                ["Description", viewItem.description],
                ["Category", viewItem.category],
                ["Found at", viewItem.locationFound],
                ["Date found", viewItem.dateFound?.slice(0, 10)],
                ["Storage", viewItem.storage],
                ["Logged by", viewItem.guardName],
                ["AI match", viewItem.aiPercent ? `${viewItem.aiPercent}%${viewItem.matchedItem ? ` with ${viewItem.matchedItem}` : ""}` : "No strong match yet"],
              ]} />
            </div>
          </div>
        </AdminModal>
      )}

      {formItem && (
        <FoundItemFormModal
          item={formItem.item}
          busy={actionBusy}
          onClose={() => setFormItem(null)}
          onSubmit={(data) => setPendingAction({ type: "save", data, reference: formItem.item?.id })}
        />
      )}

      {pendingAction && (
        <ConfirmActionDialog
          title={pendingAction.type === "delete" ? tr("delete found item {0}?", { "0": pendingAction.reference }) : pendingAction.reference ? tr("save these found-item changes?") : tr("register this found item?")}
          description={pendingAction.type === "delete" ? tr("This moves {0}, its photo, and its linked claim records to the Recycle bin, where a super admin can restore them.", { "0": pendingAction.reference }) : tr("The change is saved to the shared item registry.")}
          confirmLabel={pendingAction.type === "delete" ? tr("Delete item") : pendingAction.reference ? tr("Save changes") : tr("Register item")}
          danger={pendingAction.type === "delete"}
          busy={actionBusy}
          onCancel={() => { if (!actionBusy) setPendingAction(null); }}
          onConfirm={() => void confirmPendingAction()}
        />
      )}
    </div>
  );
}
