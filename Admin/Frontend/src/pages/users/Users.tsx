import { useEffect, useState } from "react";
import { User, users as initialUsers } from "../../data/mockData";
import { deleteAdminUser, fetchAdminAccountVerifications, fetchAdminUsers, getStoredAdmin, updateAdminUserAccessLevel, updateAdminUserStatus, type AdminAccountVerificationRequest } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import AccountVerificationTab from "./AccountVerificationTab";

function Avatar({ initials, color }: { initials: string; color?: string }) {
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
      style={{ background: color ?? "#1f3160" }}>
      {initials}
    </div>
  );
}

function StatusBadge({ status }: { status: User["status"] }) {
  const map: Record<User["status"], { bg: string; text: string; dot: string }> = {
    "Active": { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    "Suspended": { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
    "Inactive": { bg: "#f8fafc", text: "#64748b", dot: "#94a3b8" },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}></span>
      {status}
    </span>
  );
}

const AVATAR_COLORS = ["#1f3160","#0f8077","#7c3aed","#2563eb","#d97706","#dc2626","#059669","#9333ea"];

interface UserModalProps {
  user: User | null;
  onClose: () => void;
  onReject: (id: string) => void;
  onActivate: (id: string) => void;
}

function UserModal({ user, onClose, onReject, onActivate }: UserModalProps) {
  if (!user) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">User Profile</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: AVATAR_COLORS[parseInt(user.id) - 1] }}>
            {user.initials}
          </div>
          <div>
            <div className="font-bold text-slate-900 text-lg">{user.name}</div>
            <div className="text-sm text-slate-400">{user.studentId}</div>
            <StatusBadge status={user.status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          {[
            ["Email", user.email],
            ["Program", user.program],
            ["Admin access", user.accessLevel === "super_admin" ? "Super Admin" : user.accessLevel === "admin" ? "Admin" : "Standard user"],
            ["Lost Reports", String(user.reports)],
            ["Claims Filed", String(user.claims)],
            ["Last Activity", user.lastActivity],
          ].map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-400 font-semibold mb-0.5">{k}</div>
              <div className="font-medium text-slate-800">{v}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-slate-600 border border-line rounded-lg hover:bg-navy-50">Close</button>
          {user.status === "Active" ? (
            <button onClick={() => { onReject(user.id); onClose(); }} className="flex-1 py-2 text-sm font-semibold text-white rounded-lg hover:opacity-90" style={{ background: "#dc2626" }}>
              Suspend Account
            </button>
          ) : (
            <button onClick={() => { onActivate(user.id); onClose(); }} className="flex-1 py-2 text-sm font-semibold text-white rounded-lg hover:opacity-90" style={{ background: "#0f8077" }}>
              Reactivate Account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [viewUser, setViewUser] = useState<User | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "suspend" | "activate" | "access" | "delete"; userId: string; title: string; description: string; confirmText: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"users" | "verification">("users");
  const [verificationRequests, setVerificationRequests] = useState<AdminAccountVerificationRequest[]>([]);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const currentAdmin = getStoredAdmin();
  const currentAdminId = currentAdmin?.account_id;
  const isSuperAdmin = currentAdmin?.access_level === "super_admin";

  useEffect(() => {
    let active = true;
    const loadUsers = async () => {
      try {
        const data = await fetchAdminUsers();
        if (!active) return;
        setUsers(data);
      } catch {
        if (!active) return;
        setUsers([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    const refreshUsers = () => {
      setLoading(true);
      loadUsers();
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
        if (!active) return;
        setVerificationError(error instanceof Error ? error.message : "Unable to load account verification requests.");
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

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.studentId.includes(q) || u.email.toLowerCase().includes(q);
  });

  const reject = async (id: string) => {
    try {
      await updateAdminUserStatus(id, "suspended");
      setUsers(await fetchAdminUsers());
    } catch (error) {
      showInfoModal({ variant: "error", title: "Account not suspended", message: error instanceof Error ? error.message : "Unable to suspend this account.", replaceAuto: true });
    }
  };
  const activate = async (id: string) => {
    try {
      await updateAdminUserStatus(id, "active");
      setUsers(await fetchAdminUsers());
    } catch (error) {
      showInfoModal({ variant: "error", title: "Account not reactivated", message: error instanceof Error ? error.message : "Unable to reactivate this account.", replaceAuto: true });
    }
  };

  const requestStatusChange = (userId: string, type: "suspend" | "activate") => {
    const target = users.find((user) => user.id === userId);
    if (!target) return;
    setConfirmAction({
      type,
      userId,
      title: type === "suspend" ? "Suspend account" : "Reactivate account",
      description: type === "suspend"
        ? `This disables ${target.name}'s access to the platform until reactivated.`
        : `This restores ${target.name}'s access to the platform.`,
      confirmText: type === "suspend" ? "Suspend" : "Reactivate",
    });
  };

  const changeAccess = async (user: User) => {
    const nextLevel = user.accessLevel === "admin" ? "user" : "admin";
    const action = nextLevel === "admin" ? "promote this user to Admin" : "remove this user's Admin access";
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

  if (loading) {
    return (
      <div className="p-6 space-y-5" aria-busy="true">
        <div><SkeletonBlock className="mb-2 h-7 w-48" /><SkeletonBlock className="h-4 w-40" /></div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm"><SkeletonBlock className="h-10 w-full max-w-md" /></div>
        <AdminTableSkeleton columns={9} rows={7} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div role="tablist" aria-label="User administration views" className="flex w-fit gap-1 rounded-lg border border-line bg-white p-1">
        <button type="button" role="tab" aria-selected={activeTab === "users"} onClick={() => setActiveTab("users")} className={`rounded-md px-4 py-2 text-sm font-semibold ${activeTab === "users" ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-navy-50"}`}>Users</button>
        <button type="button" role="tab" aria-selected={activeTab === "verification"} onClick={() => setActiveTab("verification")} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${activeTab === "verification" ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-navy-50"}`}>
          Account Verification
          {verificationRequests.length > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[12px] font-bold text-white">{verificationRequests.length > 99 ? "99+" : verificationRequests.length}</span>}
        </button>
      </div>
      {activeTab === "users" ? <>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="text-sm text-slate-500">{users.length} registered users{isSuperAdmin ? " · Super Admin access controls enabled" : ""}</p>
      </div>

      <div className="bg-white rounded-2xl border border-line shadow-card p-4">
        <div className="relative max-w-md">
          <svg className="absolute left-3 top-2.5 text-slate-400" width="15" height="15" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, ID, or email..." className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-line shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["STUDENT","EMAIL","PROGRAM","ACCESS","REPORTS","CLAIMS","STATUS","LAST ACTIVITY","ACTIONS"].map(h => (
                <th key={h} className="text-left px-5 py-4 text-xs font-semibold text-slate-400 tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.id} className="border-b border-line hover:bg-navy-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar initials={u.initials} color={AVATAR_COLORS[i % AVATAR_COLORS.length]} />
                    <div>
                      <div className="font-semibold text-slate-900">{u.name}</div>
                      <div className="text-xs text-slate-400">{u.studentId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-slate-600 text-xs">{u.email}</td>
                <td className="px-5 py-4 text-slate-600">{u.program}</td>
                <td className="px-5 py-4">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${u.accessLevel === "super_admin" ? "bg-amber-100 text-amber-800" : u.accessLevel === "admin" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
                    {u.accessLevel === "super_admin" ? "Super Admin" : u.accessLevel === "admin" ? "Admin" : "User"}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "#eff6ff", color: "#2563eb" }}>{u.reports}</span>
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "#f5f3ff", color: "#7c3aed" }}>{u.claims}</span>
                </td>
                <td className="px-5 py-4"><StatusBadge status={u.status} /></td>
                <td className="px-5 py-4 text-slate-500 text-xs">{u.lastActivity}</td>
                <td className="px-5 py-4">
                  <div className="relative">
                    <button onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                      <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                    </button>
                    {openMenu === u.id && (
                      <div className="absolute right-0 top-8 bg-white border border-line rounded-xl shadow-lg py-1.5 z-10 w-40" onMouseLeave={() => setOpenMenu(null)}>
                        <button onClick={() => { setViewUser(u); setOpenMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-navy-50">View Profile</button>
                        {isSuperAdmin && u.accessLevel !== "super_admin" && (
                          <button disabled={accessBusy === u.id} onClick={() => {
                            setOpenMenu(null);
                            setConfirmAction({
                              type: "access",
                              userId: u.id,
                              title: u.accessLevel === "admin" ? "Remove admin access" : "Promote to admin",
                              description: u.accessLevel === "admin"
                                ? "This action removes the selected user's administrator permissions."
                                : "This action grants the selected user administrator permissions for the management panel.",
                              confirmText: u.accessLevel === "admin" ? "Remove access" : "Promote",
                            });
                          }} className="w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                            {accessBusy === u.id ? "Updating…" : u.accessLevel === "admin" ? "Remove Admin access" : "Promote to Admin"}
                          </button>
                        )}
                        {isSuperAdmin && currentAdminId !== u.id && <button onClick={() => {
                          setOpenMenu(null);
                          setConfirmAction({
                            type: "delete",
                            userId: u.id,
                            title: "Delete user account",
                            description: `This permanently deletes ${u.name}'s account and removes owned reports, claims, notifications, verification data, and associated files. This cannot be undone.`,
                            confirmText: "Delete account",
                          });
                        }} className="w-full text-left px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete account</button>}
                        {u.status === "Active"
                          ? <button onClick={() => {
                              setOpenMenu(null);
                              setConfirmAction({
                                type: "suspend",
                                userId: u.id,
                                title: "Suspend account",
                                description: "This action disables the user's access to the platform until reactivated.",
                                confirmText: "Suspend",
                              });
                            }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-navy-50">Suspend</button>
                          : <button onClick={() => {
                              setOpenMenu(null);
                              setConfirmAction({
                                type: "activate",
                                userId: u.id,
                                title: "Reactivate account",
                                description: "This action restores the user's access to the platform.",
                                confirmText: "Reactivate",
                              });
                            }} className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-navy-50">Reactivate</button>
                        }
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
            if (!user) {
              setConfirmAction(null);
              return;
            }
            const actionType = confirmAction.type;
            setConfirmAction(null);
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
                    message: `The account was deleted, but storage cleanup needs attention for account ${user.id}.`,
                    details: [`Affected storage: ${result.storage_cleanup_failures.join(", ") || "unknown bucket"}`],
                    replaceAuto: true,
                  });
                }
              } catch (error) {
                showInfoModal({ variant: "error", title: "Account not deleted", message: error instanceof Error ? error.message : "Unable to delete this account.", replaceAuto: true });
              }
            } else if (actionType === "suspend") await reject(user.id);
            else if (actionType === "activate") await activate(user.id);
            else await changeAccess(user);
          }}
        />
      )}

      <UserModal
        user={viewUser}
        onClose={() => setViewUser(null)}
        onReject={(id) => requestStatusChange(id, "suspend")}
        onActivate={(id) => requestStatusChange(id, "activate")}
      />
      </> : <AccountVerificationTab
        requests={verificationRequests}
        loading={verificationLoading}
        error={verificationError}
        onRefresh={() => {
          setVerificationLoading(true);
          void fetchAdminAccountVerifications().then(setVerificationRequests).catch((error) => setVerificationError(error instanceof Error ? error.message : "Unable to load account verification requests.")).finally(() => setVerificationLoading(false));
        }}
        onReviewed={() => window.dispatchEvent(new CustomEvent("ebalik-account-verifications-updated"))}
      />}
    </div>
  );
}
