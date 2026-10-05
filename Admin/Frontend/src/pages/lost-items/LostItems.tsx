import { useEffect, useMemo, useState } from "react";
import { Eye, PackageSearch, Pencil, Plus, Trash2 } from "lucide-react";
import { createAdminLostItem, deleteAdminLostItem, fetchAdminLostItems, updateAdminLostItem, type AdminLostItemRow } from "../../utils/api";
import { canDelete } from "../../utils/permissions";
import { useT, tr } from "../../utils/preferences";
import { downloadCsv } from "../../utils/csv";
import { CAMPUS_LOCATIONS, ITEM_CATEGORIES, categoryOptions, uniqueSorted } from "../../utils/itemOptions";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, PageHeader, RolePill, SelectInput, TextArea, TextInput } from "../../components/ui/primitives";
import { DataTable, DetailGrid, ExportButton, FilterSelect, IconAction, RowActions, SearchField, SegmentedFilter, StatusPill, TableFooter, Thumb, Toolbar, usePagination, type Tone } from "../../components/ui/management";

type LostItem = AdminLostItemRow;
type LostStatus = LostItem["status"];
type LostForm = { item: string; description: string; category: string; location: string; dateLost: string; reportedBy: string; studentId: string; status?: string };
type PendingAction =
  | { type: "save"; data: LostForm; reference?: string }
  | { type: "delete"; reference: string };

const STATUS_TONE: Record<LostStatus, Tone> = {
  "Searching": "gold",
  "Potential Match": "iris",
  "Found": "iris",
  "Resolved": "mint",
  "Expired": "rose",
};

/** Stored lifecycle values an admin can set (missing_items.status). */
const EDITABLE_STATUSES = [
  { value: "missing", label: "Still searching" },
  { value: "found", label: "Item found, not yet returned" },
  { value: "returned", label: "Returned to owner" },
];

const ALL = "__all__";

function LostItemFormModal({ item, busy, onClose, onSubmit }: { item?: LostItem; busy: boolean; onClose: () => void; onSubmit: (data: LostForm) => void }) {
  const editing = Boolean(item);
  const [form, setForm] = useState<LostForm>({
    item: item?.item ?? "",
    description: item && item.description !== "No description" ? item.description : "",
    category: item?.category ?? ITEM_CATEGORIES[0],
    location: item?.location && item.location !== "Unknown" ? item.location : "",
    dateLost: item?.dateLost ?? "",
    reportedBy: item?.reportedBy ?? "",
    studentId: item && item.studentId !== "N/A" ? item.studentId : "",
    status: item?.rawStatus ?? "missing",
  });
  const [error, setError] = useState("");
  const set = (key: keyof LostForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const today = new Date().toISOString().slice(0, 10);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const required: [keyof LostForm, string][] = [["item", tr("item name")], ["category", "category"], ["location", tr("last seen location")], ["dateLost", tr("date lost")], ["reportedBy", tr("reporter name")], ["studentId", tr("campus ID")]];
    const missing = required.filter(([key]) => !String(form[key] ?? "").trim()).map(([, label]) => label);
    if (missing.length) {
      setError(tr("Add the {0} before saving.", { "0": missing.join(", ") }));
      return;
    }
    if (form.dateLost > today) {
      setError(tr("The date lost can't be in the future."));
      return;
    }
    setError("");
    const trimmed = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as LostForm;
    if (!editing) delete trimmed.status;
    onSubmit(trimmed);
  };

  return (
    <AdminModal
      title={editing ? tr("Edit {0}", { "0": item?.id }) : tr("Add a lost report")}
      description={editing ? tr("Update the report details or move it along its search status.") : tr("For owners who report a lost item at the office. The report joins AI matching right away.")}
      icon={editing ? <Pencil size={19} /> : <Plus size={20} />}
      tone={editing ? "navy" : "gold"}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="submit" form="lost-item-form" disabled={busy} className={editing ? BTN.primary : BTN.gold}>{editing ? tr("Save changes") : tr("Add report")}</button>
        </>
      }
    >
      <form id="lost-item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={tr("Item name")} required>{(id) => <TextInput id={id} data-autofocus value={form.item} onChange={(e) => set("item", e.target.value)} maxLength={255} placeholder={tr("Black JanSport backpack")} />}</Field>
        <Field label={tr("Category")} required>{(id) => (
          <SelectInput id={id} value={form.category} onChange={(e) => set("category", e.target.value)}>
            {categoryOptions(item?.category).map((category) => <option key={category}>{category}</option>)}
          </SelectInput>
        )}</Field>
        <div className="sm:col-span-2">
          <Field label={tr("Description")} hint={tr("Colour, brand, stickers or marks that help confirm the owner.")}>{(id) => <TextArea id={id} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />}</Field>
        </div>
        <Field label={tr("Last seen at")} required>{(id) => (
          <>
            <TextInput id={id} list="lost-location-options" value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={255} placeholder={tr("Library, 2nd floor")} />
            <datalist id="lost-location-options">{CAMPUS_LOCATIONS.map((location) => <option key={location} value={location} />)}</datalist>
          </>
        )}</Field>
        <Field label={tr("Date lost")} required>{(id) => <TextInput id={id} type="date" max={today} value={form.dateLost} onChange={(e) => set("dateLost", e.target.value)} />}</Field>
        <Field label={tr("Reported by")} required>{(id) => <TextInput id={id} value={form.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} maxLength={255} placeholder={tr("Full name")} />}</Field>
        <Field label={tr("Campus ID")} required>{(id) => <TextInput id={id} value={form.studentId} onChange={(e) => set("studentId", e.target.value)} maxLength={50} placeholder={tr("K12345678")} />}</Field>
        {editing && (
          <div className="sm:col-span-2">
            <Field label={tr("Search status")} hint={tr("Returned reports count as resolved on the dashboard.")}>{(id) => (
              <SelectInput id={id} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {EDITABLE_STATUSES.map((status) => <option key={status.value} value={status.value}>{tr(status.label)}</option>)}
              </SelectInput>
            )}</Field>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 sm:col-span-2">{error}</p>}
      </form>
    </AdminModal>
  );
}

export default function LostItems() {
  const t = useT();
  const [items, setItems] = useState<LostItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [category, setCategory] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [formItem, setFormItem] = useState<{ item?: LostItem } | null>(null);
  const [viewItem, setViewItem] = useState<LostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isSuperAdmin = canDelete();

  useEffect(() => {
    let active = true;
    localStorage.removeItem("e-balik-lost-items"); // retired cache that held reporter campus IDs
    fetchAdminLostItems()
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
  const locations = useMemo(() => uniqueSorted(items.map((item) => item.location).filter((value) => value !== "Unknown")), [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== ALL && item.status !== statusFilter) return false;
      if (category !== ALL && item.category !== category) return false;
      if (location !== ALL && item.location !== location) return false;
      return !query || [item.item, item.id, item.reportedBy, item.studentId, item.description].some((value) => value?.toLowerCase().includes(query));
    });
  }, [items, search, statusFilter, category, location]);
  const paging = usePagination(filtered, 12, `${search}|${statusFilter}|${category}|${location}`);
  const hasFilters = Boolean(search) || statusFilter !== ALL || category !== ALL || location !== ALL;

  const confirmPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    try {
      if (pendingAction.type === "delete") {
        await deleteAdminLostItem(pendingAction.reference);
        setViewItem(null);
      } else if (pendingAction.reference) {
        await updateAdminLostItem(pendingAction.reference, pendingAction.data);
      } else {
        await createAdminLostItem(pendingAction.data);
      }
      setItems(await fetchAdminLostItems());
      if (pendingAction.type === "save") setFormItem(null);
    } catch {
      // adminItemMutation already reported the server's reason in the global result modal.
    } finally {
      setPendingAction(null);
      setActionBusy(false);
    }
  };

  const exportCsv = () => downloadCsv("lost-items", ["Reference", "Item", "Category", "Description", "Last seen", "Date lost", "Reported by", "Status"],
    filtered.map((item) => [item.id, item.item, item.category, item.description, item.location, item.dateLost, item.reportedBy, item.status]));

  if (loading) {
    return <div className="space-y-5 p-4 sm:p-6" aria-busy="true"><div><SkeletonBlock className="mb-2 h-8 w-56" /><SkeletonBlock className="h-4 w-80" /></div><SkeletonBlock className="h-14 w-full rounded-2xl" /><AdminTableSkeleton columns={8} rows={7} /></div>;
  }

  const statusTabs: { value: string; label: string; count: number }[] = [
    { value: ALL, label: t("common.allStatuses"), count: items.length },
    ...(["Searching", "Potential Match", "Found", "Resolved", "Expired"] as LostStatus[])
      .filter((status) => statusCounts[status])
      .map((status) => ({ value: status, label: status, count: statusCounts[status] })),
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("lost.title")}
        description={t("lost.description", { count: items.length })}
        meta={<RolePill superAdmin={isSuperAdmin} />}
        actions={<>
          <ExportButton onClick={exportCsv} disabled={!filtered.length} />
          <button type="button" onClick={() => setFormItem({})} className={BTN.primary}><Plus size={17} aria-hidden="true" />{t("lost.add")}</button>
        </>}
      />

      <SegmentedFilter label={t("common.status")} value={statusFilter} onChange={setStatusFilter} options={statusTabs} />

      <Toolbar trailing={hasFilters ? <button type="button" onClick={() => { setSearch(""); setStatusFilter(ALL); setCategory(ALL); setLocation(ALL); }} className={BTN.ghost}>{t("common.clearFilters")}</button> : undefined}>
        <SearchField value={search} onChange={setSearch} placeholder={t("lost.search")} />
        <FilterSelect label={t("lost.col.category")} value={category} onChange={setCategory} options={[{ value: ALL, label: t("common.allCategories") }, ...categories.map((value) => ({ value, label: value }))]} />
        <FilterSelect label={t("lost.col.location")} value={location} onChange={setLocation} options={[{ value: ALL, label: t("common.allLocations") }, ...locations.map((value) => ({ value, label: value }))]} />
      </Toolbar>

      <DataTable
        caption={t("lost.title")}
        columns={[
          { key: "ref", label: t("lost.col.reference") },
          { key: "item", label: t("lost.col.item") },
          { key: "category", label: t("lost.col.category") },
          { key: "location", label: t("lost.col.location") },
          { key: "date", label: t("lost.col.date") },
          { key: "reporter", label: t("lost.col.reporter") },
          { key: "status", label: t("common.status") },
          { key: "actions", label: t("common.actions") },
        ]}
        isEmpty={paging.pageItems.length === 0}
        empty={items.length === 0 ? t("lost.empty") : t("common.noMatches")}
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
                  <div className="truncate text-[13px] text-ink-muted" title={item.description}>{item.description}</div>
                </div>
              </div>
            </td>
            <td className="whitespace-nowrap">{item.category}</td>
            <td><div className="max-w-[180px] truncate" title={item.location}>{item.location}</div></td>
            <td className="whitespace-nowrap">{item.dateLost || "—"}</td>
            <td>
              <div className="max-w-[180px] truncate font-medium text-ink">{item.reportedBy}</div>
              <div className="text-[13px] text-ink-muted">{item.studentId}</div>
            </td>
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
          description={tr("Report {0}, filed by {1}", { "0": viewItem.id, "1": viewItem.reportedBy })}
          icon={<PackageSearch size={20} />}
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
                ["Last seen at", viewItem.location],
                ["Date lost", viewItem.dateLost],
                ["Reported by", viewItem.reportedBy],
                ["Campus ID", viewItem.studentId],
              ]} />
            </div>
          </div>
        </AdminModal>
      )}

      {formItem && (
        <LostItemFormModal
          item={formItem.item}
          busy={actionBusy}
          onClose={() => setFormItem(null)}
          onSubmit={(data) => setPendingAction({ type: "save", data, reference: formItem.item?.id })}
        />
      )}

      {pendingAction && (
        <ConfirmActionDialog
          title={pendingAction.type === "delete" ? tr("delete lost report {0}?", { "0": pendingAction.reference }) : pendingAction.reference ? tr("save these lost-report changes?") : tr("add this lost report?")}
          description={pendingAction.type === "delete" ? tr("This permanently deletes {0}, its photo, and its AI match suggestions.", { "0": pendingAction.reference }) : tr("The change is saved to the shared item registry.")}
          confirmLabel={pendingAction.type === "delete" ? tr("Delete report") : pendingAction.reference ? tr("Save changes") : tr("Add report")}
          danger={pendingAction.type === "delete"}
          busy={actionBusy}
          onCancel={() => { if (!actionBusy) setPendingAction(null); }}
          onConfirm={() => void confirmPendingAction()}
        />
      )}
    </div>
  );
}
