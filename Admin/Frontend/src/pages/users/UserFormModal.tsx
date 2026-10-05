import { useState } from "react";
import { KeyRound, UserPen, UserPlus } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, SelectInput, TextInput } from "../../components/ui/primitives";
import { createAdminUser, updateAdminUser, type AdminUserInput, type AdminUserRow } from "../../utils/api";

import { tr } from "../../utils/preferences";
const ROLES: AdminUserInput["user_role"][] = ["Student", "Faculty", "Staff", "Others"];
const MIN_PASSWORD = 16;

function splitName(user?: AdminUserRow) {
  const parts = (user?.name || "").trim().split(/\s+/);
  return { fname: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "", lname: parts.length > 1 ? parts[parts.length - 1] : "" };
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

/** Create a user account, or edit an existing account's profile details. */
export default function UserFormModal({ user, onClose, onSaved }: { user?: AdminUserRow; onClose: () => void; onSaved: (user: AdminUserRow) => void }) {
  const editing = Boolean(user);
  const initialName = splitName(user);
  const [fname, setFname] = useState(initialName.fname);
  const [mname, setMname] = useState("");
  const [lname, setLname] = useState(initialName.lname);
  const [email, setEmail] = useState(user?.email ?? "");
  const [campusId, setCampusId] = useState(user && user.studentId !== "N/A" ? user.studentId : "");
  const [role, setRole] = useState<AdminUserInput["user_role"]>((ROLES.find((r) => r === user?.program) ?? "Student"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!editing && password.length < MIN_PASSWORD) {
      setError(tr("The temporary password must be at least {0} characters.", { "0": MIN_PASSWORD }));
      return;
    }
    setBusy(true);
    try {
      const details: AdminUserInput = { fname: fname.trim(), lname: lname.trim(), email: email.trim(), campus_id: campusId.trim(), user_role: role, ...(mname.trim() ? { mname: mname.trim() } : {}) };
      const result = editing && user ? await updateAdminUser(user.id, details) : await createAdminUser({ ...details, password });
      onSaved(result.user);
      onClose();
    } catch {
      // The API helper already reported the server's reason through the global result modal; keep the form open to fix it.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal
      title={editing ? tr("Edit account details") : tr("Add a user account")}
      description={editing ? tr("Update {0}'s profile. Access level and status are managed separately.", { "0": user?.name || tr("this user") }) : tr("Creates a standard user account. Share the temporary password with the person securely; they can change it from Forgot password.")}
      icon={editing ? <UserPen size={20} /> : <UserPlus size={20} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="submit" form="admin-user-form" disabled={busy} className={BTN.primary}>{busy ? tr("Saving…") : editing ? tr("Save changes") : tr("Create account")}</button>
        </>
      }
    >
      <form id="admin-user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("First name")} required>{(id) => <TextInput id={id} data-autofocus value={fname} onChange={(e) => setFname(e.target.value)} required maxLength={100} autoComplete="off" />}</Field>
        <Field label={tr("Last name")} required>{(id) => <TextInput id={id} value={lname} onChange={(e) => setLname(e.target.value)} required maxLength={100} autoComplete="off" />}</Field>
        <Field label={tr("Middle name")} hint={editing ? tr("Leave blank to keep the current value.") : undefined}>{(id) => <TextInput id={id} value={mname} onChange={(e) => setMname(e.target.value)} maxLength={100} autoComplete="off" />}</Field>
        <Field label={tr("Role")}>{(id) => (
          <SelectInput id={id} value={role} onChange={(e) => setRole(e.target.value as AdminUserInput["user_role"])}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </SelectInput>
        )}</Field>
        <div className="sm:col-span-2">
          <Field label={tr("Email")} required>{(id) => <TextInput id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} autoComplete="off" placeholder={tr("j.delacruz.k12345678@umak.edu.ph")} />}</Field>
        </div>
        <Field label={tr("Campus ID")} required>{(id) => <TextInput id={id} value={campusId} onChange={(e) => setCampusId(e.target.value)} required maxLength={50} autoComplete="off" placeholder={tr("K12345678")} />}</Field>
        {!editing && (
          <Field label={tr("Temporary password")} required hint={tr("At least {0} characters.", { "0": MIN_PASSWORD })}>{(id) => (
            <div className="flex gap-2">
              <TextInput id={id} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" className="font-medium tracking-wide" />
              <button type="button" onClick={() => setPassword(generatePassword())} className={`${BTN.ghost} shrink-0 px-3`} title={tr("Generate a strong password")}>
                <KeyRound size={16} aria-hidden="true" /><span className="sr-only sm:not-sr-only">{tr("Generate")}</span>
              </button>
            </div>
          )}</Field>
        )}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 sm:col-span-2">{error}</p>}
      </form>
    </AdminModal>
  );
}
