import { useEffect, useMemo, useState } from "react";
import { Eye, Pencil, ShieldMinus, ShieldPlus, Trash2, UserCheck, UserPlus, UserRound, UserX } from "lucide-react";
import type { User } from "../../data/mockData";
import { deleteAdminUser, fetchAdminAccountVerifications, fetchAdminUsers, getStoredAdmin, updateAdminUserAccessLevel, updateAdminUserStatus, type AdminAccountVerificationRequest } from "../../utils/api";
import { canDelete } from "../../utils/permissions";
import { useT } from "../../utils/preferences";
import { downloadCsv } from "../../utils/csv";
import UserFormModal from "./UserFormModal";
import AccountVerificationTab from "./AccountVerificationTab";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, PageHeader, RolePill } from "../../components/ui/primitives";
import { DataTable, DetailGrid, ExportButton, FilterSelect, IconAction, RowActions, SearchField, SegmentedFilter, StatusPill, TableFooter, Toolbar, usePagination, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { tr } from "../../utils/preferences";

const STATUS_TONE: Record<User["status"], Tone> = { Active: "mint", Suspended: "rose", Inactive: "slate" };
const ACCESS_LABEL: Record<User["accessLevel"], string> = { super_admin: "Super admin", admin: "Admin", user: "User" };
const ACCESS_TONE: Record<User["accessLevel"], Tone> = { super_admin: "gold", admin: "iris", user: "slate" };
const AVATAR_GRADIENTS = [
  "linear-gradient(145deg,#2b4282,#1f3160)",
  "linear-gradient(145deg,#ecc787,#b9873a)",
  "linear-gradient(145deg,#6fd6bb,#1b7863)",
  "linear-gradient(145deg,#a3b6f7,#5470d6)",
];
const ALL = "__all__";

type ConfirmState = { type: "suspend" | "activate" | "access" | "delete"; userId: string; title: string; description: string; confirmText: string };

function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const seed = Array.from(user.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const gradient = AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-white/10" style={{ width: size, height: size, background: gradient, fontSize: size * 0.36 }} aria-hidden="true">
      {user.initials}
    </span>
  );
}

export default function Users() {
  const t = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [accessFilter, setAccessFilter] = useState(ALL);
  const [viewUser, setViewUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null);
  const [activeTab, setActiveTab] = useState<"users" | "verification">("users");
  const [userForm, setUserForm] = useState<{ user?: User } | null>(null);
  const [verificationRequests, setVerificationRequests] = useState<AdminAccountVerificationRequest[]>([]);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const currentAdminId = getStoredAdmin()?.account_id;
  const isSuperAdmin = canDelete();

  useEffect(() => {
    let active = true;
    const loadUsers = async () => {
      try {
        const data = await fetchAdminUsers();
        if (active) setUsers(data);
      } catch {
        if (active) setUsers([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    const refreshUsers = () => {
      setLoading(true);
      void loadUsers();
    };
    refreshUsers();
    window.addEventListener("ebalik-claims-updated", refreshUsers);
    return () => {
      active = false;
      window.removeEventListener("ebalik-claims-updated", refreshUsers);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadVerificationRequests = async () => {
      try {
        const requests = await fetchAdminAccountVerifications();
        if (!active) return;
        setVerificationRequests(requests);
        setVerificationError("");
      } catch (error) {
        if (active) setVerificationError(error instanceof Error ? error.message : tr("Unable to load account verification requests."));
      } finally {
        if (active) setVerificationLoading(false);
      }
    };
    void loadVerificationRequests();
    const onUpdated = () => void loadVerificationRequests();
    window.addEventListener("ebalik-account-verifications-updated", onUpdated);
    const refreshTimer = window.setInterval(() => {
      if (!document.hidden) void loadVerificationRequests();
    }, 30000);
    return () => {
      active = false;
      window.removeEventListener("ebalik-account-verifications-updated", onUpdated);
      window.clearInterval(refreshTimer);
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter !== ALL && user.status !== statusFilter) return false;
      if (accessFilter !== ALL && user.accessLevel !== accessFilter) return false;
      return !query || user.name.toLowerCase().includes(query) || user.studentId.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
    });
  }, [users, search, statusFilter, accessFilter]);
  const paging = usePagination(filtered, 12, `${search}|${statusFilter}|${accessFilter}`);
  const hasFilters = Boolean(search) || statusFilter !== ALL || accessFilter !== ALL;

  const setStatus = async (id: string, status: "suspended" | "active") => {
    try {
      await updateAdminUserStatus(id, status);
      setUsers(await fetchAdminUsers());
    } catch (error) {
      showInfoModal({ variant: "error", title: status === "suspended" ? "Account not suspended" : "Account not reactivated", message: error instanceof Error ? error.message : "Unable to change this account's status.", replaceAuto: true });
    }
  };

  const changeAccess = async (user: User) => {
    const nextLevel = user.accessLevel === "admin" ? "user" : "admin";
    setAccessBusy(user.id);
    try {
      const response = await updateAdminUserAccessLevel(user.id, nextLevel);
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, accessLevel: response.user.access_level } : row));
    } catch (error) {
      showInfoModal({ variant: "error", title: "Access level not changed", message: error instanceof Error ? error.message : "Unable to change user access.", replaceAuto: true });
    } finally {
      setAccessBusy(null);
    }
  };

  const askStatus = (user: User) => setConfirmAction(user.status === "Active"
    ? { type: "suspend", userId: user.id, title: tr("suspend {0}?", { "0": user.name }), description: tr("{0} can't sign in or file reports until the account is reactivated.", { "0": user.name }), confirmText: "Suspend account" }
    : { type: "activate", userId: user.id, title: tr("reactivate {0}?", { "0": user.name }), description: tr("{0} can sign in and use E-Balik again.", { "0": user.name }), confirmText: "Reactivate account" });

  const askAccess = (user: User) => setConfirmAction({
    type: "access",
    userId: user.id,
    title: user.accessLevel === "admin" ? tr("remove admin access from {0}?", { "0": user.name }) : tr("make {0} an admin?", { "0": user.name }),
    description: user.accessLevel === "admin"
      ? "They keep their user account but lose access to this console."
      : "They can create, view and edit records in this console. Only super admins can delete.",
    confirmText: user.accessLevel === "admin" ? "Remove admin access" : "Make admin",
  });

  const askDelete = (user: User) => setConfirmAction({
    type: "delete",
    userId: user.id,
    title: tr("delete {0}'s account?", { "0": user.name }),
    description: tr("This permanently deletes the account and removes owned reports, claims, notifications, verification data and files. This can't be undone."),
    confirmText: "Delete account",
  });

  const exportCsv = () => downloadCsv("users", ["Name", "Campus ID", "Email", "Role", "Access", "Reports", "Claims", "Status", "Last activity"],
    filtered.map((user) => [user.name, user.studentId, user.email, user.program, ACCESS_LABEL[user.accessLevel], user.reports, user.claims, user.status, user.lastActivity]));

  if (loading) {
    return (
      <div className="space-y-5 p-4 sm:p-6" aria-busy="true">
        <div><SkeletonBlock className="mb-2 h-8 w-48" /><SkeletonBlock className="h-4 w-80" /></div>
        <SkeletonBlock className="h-14 w-full rounded-2xl" />
        <AdminTableSkeleton columns={8} rows={7} />
      </div>
    );
  }

  const canEdit = (user: User) => isSuperAdmin || user.accessLevel !== "super_admin";

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("users.title")}
        description={t("users.description", { count: users.length })}
        meta={<RolePill superAdmin={isSuperAdmin} />}
        actions={activeTab === "users" ? <>
          <ExportButton onClick={exportCsv} disabled={!filtered.length} />
          <button type="button" onClick={() => setUserForm({})} className={BTN.primary}><UserPlus size={17} aria-hidden="true" />{t("users.add")}</button>
        </> : undefined}
      />

      <SegmentedFilter
        label={t("users.title")}
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { value: "users", label: t("users.tab.accounts"), count: users.length },
          { value: "verification", label: t("users.tab.verification"), count: verificationRequests.length },
        ]}
      />

      {activeTab === "users" ? <>
        <Toolbar trailing={hasFilters ? <button type="button" onClick={() => { setSearch(""); setStatusFilter(ALL); setAccessFilter(ALL); }} className={BTN.ghost}>{t("common.clearFilters")}</button> : undefined}>
          <SearchField value={search} onChange={setSearch} placeholder={t("users.search")} />
          <FilterSelect label={t("common.status")} value={statusFilter} onChange={setStatusFilter} options={[{ value: ALL, label: t("common.allStatuses") }, { value: "Active", label: "Active" }, { value: "Suspended", label: "Suspended" }, { value: "Inactive", label: "Inactive" }]} />
          <FilterSelect label={t("users.col.access")} value={accessFilter} onChange={setAccessFilter} options={[{ value: ALL, label: t("users.allAccess") }, { value: "user", label: "Users" }, { value: "admin", label: "Admins" }, { value: "super_admin", label: "Super admins" }]} />
        </Toolbar>

        <DataTable
          caption={t("users.title")}
          minWidth={1040}
          columns={[
            { key: "name", label: t("users.col.name") },
            { key: "email", label: t("users.col.email") },
            { key: "role", label: t("users.col.role") },
            { key: "access", label: t("users.col.access") },
            { key: "reports", label: t("users.col.reports"), className: "text-right" },
            { key: "claims", label: t("users.col.claims"), className: "text-right" },
            { key: "status", label: t("common.status") },
            { key: "last", label: t("users.col.lastActivity") },
            { key: "actions", label: t("common.actions") },
          ]}
          isEmpty={paging.pageItems.length === 0}
          empty={users.length === 0 ? t("users.empty") : t("common.noMatches")}
          footer={<TableFooter {...paging} onPage={paging.setPage} />}
        >
          {paging.pageItems.map((user) => (
            <tr key={user.id} data-tone={STATUS_TONE[user.status]}>
              <td>
                <div className="flex min-w-[200px] items-center gap-3">
                  <Avatar user={user} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{user.name}{user.id === currentAdminId && <span className="ml-1.5 text-[12px] font-medium text-ink-muted">(you)</span>}</div>
                    <div className="text-[13px] text-ink-muted">{user.studentId}</div>
                  </div>
                </div>
              </td>
              <td><div className="max-w-[240px] truncate text-[13.5px]" title={user.email}>{user.email}</div></td>
              <td className="whitespace-nowrap">{user.program}</td>
              <td><StatusPill tone={ACCESS_TONE[user.accessLevel]}>{ACCESS_LABEL[user.accessLevel]}</StatusPill></td>
              <td className="text-right font-semibold text-ink">{user.reports}</td>
              <td className="text-right font-semibold text-ink">{user.claims}</td>
              <td><StatusPill tone={STATUS_TONE[user.status]}>{user.status}</StatusPill></td>
              <td className="whitespace-nowrap text-[13px] text-ink-muted">{user.lastActivity}</td>
              <RowActions>
                <IconAction label={`${t("common.view")} ${user.name}`} onClick={() => setViewUser(user)} icon={<Eye size={17} aria-hidden="true" />} />
                {canEdit(user) && <IconAction label={`${t("common.edit")} ${user.name}`} tone="gold" onClick={() => setUserForm({ user })} icon={<Pencil size={16} aria-hidden="true" />} />}
                {isSuperAdmin && user.accessLevel !== "super_admin" && (
                  <IconAction
                    label={user.accessLevel === "admin" ? tr("Remove admin access from {0}", { "0": user.name }) : tr("Make {0} an admin", { "0": user.name })}
                    disabled={accessBusy === user.id}
                    onClick={() => askAccess(user)}
                    icon={user.accessLevel === "admin" ? <ShieldMinus size={17} aria-hidden="true" /> : <ShieldPlus size={17} aria-hidden="true" />}
                  />
                )}
                {canEdit(user) && user.id !== currentAdminId && (
                  <IconAction
                    label={user.status === "Active" ? tr("Suspend {0}", { "0": user.name }) : tr("Reactivate {0}", { "0": user.name })}
                    tone={user.status === "Active" ? "danger" : "success"}
                    onClick={() => askStatus(user)}
                    icon={user.status === "Active" ? <UserX size={17} aria-hidden="true" /> : <UserCheck size={17} aria-hidden="true" />}
                  />
                )}
                {isSuperAdmin && user.id !== currentAdminId && <IconAction label={`${t("common.delete")} ${user.name}`} tone="danger" onClick={() => askDelete(user)} icon={<Trash2 size={16} aria-hidden="true" />} />}
              </RowActions>
            </tr>
          ))}
        </DataTable>
      </> : (
        <AccountVerificationTab
          requests={verificationRequests}
          loading={verificationLoading}
          error={verificationError}
          onRefresh={() => {
            setVerificationLoading(true);
            void fetchAdminAccountVerifications().then(setVerificationRequests).catch((error) => setVerificationError(error instanceof Error ? error.message : tr("Unable to load account verification requests."))).finally(() => setVerificationLoading(false));
          }}
          onReviewed={() => window.dispatchEvent(new CustomEvent("ebalik-account-verifications-updated"))}
        />
      )}

      {viewUser && (
        <AdminModal
          title={viewUser.name}
          description={viewUser.studentId}
          icon={<UserRound size={20} />}
          onClose={() => setViewUser(null)}
          footer={<>
            {canEdit(viewUser) && viewUser.id !== currentAdminId && (
              <button type="button" onClick={() => { askStatus(viewUser); setViewUser(null); }} className={`${viewUser.status === "Active" ? BTN.danger : BTN.success} sm:mr-auto`}>
                {viewUser.status === "Active" ? <UserX size={16} aria-hidden="true" /> : <UserCheck size={16} aria-hidden="true" />}
                {viewUser.status === "Active" ? tr("Suspend account") : tr("Reactivate account")}
              </button>
            )}
            <button type="button" onClick={() => setViewUser(null)} className={BTN.ghost}>{t("common.close")}</button>
            {canEdit(viewUser) && <button type="button" onClick={() => { setUserForm({ user: viewUser }); setViewUser(null); }} className={BTN.primary}><Pencil size={16} aria-hidden="true" />{t("common.edit")}</button>}
          </>}
        >
          <div className="mb-4 flex items-center gap-4">
            <Avatar user={viewUser} size={56} />
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={STATUS_TONE[viewUser.status]}>{viewUser.status}</StatusPill>
              <StatusPill tone={ACCESS_TONE[viewUser.accessLevel]}>{ACCESS_LABEL[viewUser.accessLevel]}</StatusPill>
            </div>
          </div>
          <DetailGrid items={[
            ["Email", viewUser.email],
            ["Role", viewUser.program],
            ["Lost reports", String(viewUser.reports)],
            ["Claims filed", String(viewUser.claims)],
            ["Last activity", viewUser.lastActivity],
            ["Campus ID", viewUser.studentId],
          ]} />
        </AdminModal>
      )}

      {confirmAction && (
        <ConfirmActionDialog
          key={`${confirmAction.type}:${confirmAction.userId}`}
          title={confirmAction.title}
          description={confirmAction.description}
          confirmLabel={confirmAction.confirmText}
          danger={confirmAction.type === "suspend" || confirmAction.type === "delete"}
          requireAuthenticatorCode={confirmAction.type === "delete"}
          onCancel={() => setConfirmAction(null)}
          onConfirm={async (authenticatorCode) => {
            const user = users.find((row) => row.id === confirmAction.userId);
            const actionType = confirmAction.type;
            setConfirmAction(null);
            if (!user) return;
            if (actionType === "delete") {
              try {
                const result = await deleteAdminUser(user.id, authenticatorCode || "");
                setUsers((current) => current.filter((row) => row.id !== user.id));
                void fetchAdminUsers().then(setUsers).catch(() => undefined);
                window.dispatchEvent(new CustomEvent("ebalik-account-verifications-updated"));
                if (!result.storage_cleanup_complete) {
                  showInfoModal({
                    variant: "warning",
                    title: "Account deleted, cleanup incomplete",
                    message: tr("The account was deleted, but storage cleanup needs attention for account {0}.", { "0": user.id }),
                    details: [tr("Affected storage: {0}", { "0": result.storage_cleanup_failures.join(", ") || tr("unknown bucket") })],
                    replaceAuto: true,
                  });
                }
              } catch (error) {
                showInfoModal({ variant: "error", title: "Account not deleted", message: error instanceof Error ? error.message : "Unable to delete this account.", replaceAuto: true });
              }
            } else if (actionType === "suspend") await setStatus(user.id, "suspended");
            else if (actionType === "activate") await setStatus(user.id, "active");
            else await changeAccess(user);
          }}
        />
      )}

      {userForm && (
        <UserFormModal
          user={userForm.user}
          onClose={() => setUserForm(null)}
          onSaved={() => { void fetchAdminUsers().then(setUsers).catch(() => undefined); }}
        />
      )}
    </div>
  );
}
