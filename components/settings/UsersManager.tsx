"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SensitiveInput } from "@/components/ui/SensitiveInput";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { Role } from "@/lib/generated/prisma/enums";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  practices: { id: string; name: string }[];
}

interface PracticeOption {
  id: string;
  name: string;
  isActive: boolean;
}

export function UsersManager({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [practices, setPractices] = useState<PracticeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.BILLER);
  const [practiceIds, setPracticeIds] = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [usersRes, practicesRes] = await Promise.all([
        fetch("/api/settings/users"),
        fetch("/api/settings/practices"),
      ]);

      const usersPayload = await usersRes.json().catch(() => null);
      const practicesPayload = await practicesRes.json().catch(() => null);

      if (!usersRes.ok) {
        setLoadError(usersPayload?.error ?? "Could not load users.");
        return;
      }

      setUsers(usersPayload.data);
      setPractices(practicesRes.ok ? practicesPayload.data : []);
    } catch {
      setLoadError("Could not load users. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setName("");
    setEmail("");
    setPassword("");
    setRole(Role.BILLER);
    setPracticeIds(new Set());
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setRole(user.role);
    setPracticeIds(new Set(user.practices.map((practice) => practice.id)));
    setIsActive(user.isActive);
    setFormError(null);
    setModalOpen(true);
  }

  function togglePractice(id: string) {
    setPracticeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (name.trim().length < 2) return setFormError("Name is required.");
    if (!email.trim()) return setFormError("Email is required.");
    if (!editing && password.length < 8) {
      return setFormError("Password must be at least 8 characters.");
    }
    if (password && password.length < 8) {
      return setFormError("Password must be at least 8 characters.");
    }

    setSaving(true);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
      role,
      isActive,
      practiceIds: role === Role.OWNER ? [] : Array.from(practiceIds),
    };

    // Blank password on edit means "leave it as it is".
    if (password) payload.password = password;

    try {
      const response = await fetch(
        editing ? `/api/settings/users/${editing.id}` : "/api/settings/users",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(
          result?.error ??
            (result?.details
              ? Object.values(result.details.fieldErrors ?? {})
                  .flat()
                  .join(" ")
              : null) ??
            "Could not save the user.",
        );
        setSaving(false);
        return;
      }

      toast(editing ? "User updated" : "User created");
      setModalOpen(false);
      await load();
      router.refresh();
    } catch {
      setFormError("Could not save the user. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: UserRow) {
    try {
      const response = await fetch(`/api/settings/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not update the user.", "error");
        return;
      }

      toast(user.isActive ? "User deactivated" : "User activated");
      await load();
    } catch {
      toast("Could not update the user.", "error");
    }
  }

  const showPracticePicker = role !== Role.OWNER;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={openCreate}>Add User</Button>
      </div>

      {loading ? (
        <TableSkeleton rows={5} columns={6} />
      ) : loadError ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-100">
          {loadError}
          <button type="button" onClick={load} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned practices</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {user.name}
                    {user.id === currentUserId ? (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        (you)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={roleBadgeVariants[user.role]}>
                      {roleLabels[user.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.isActive ? "brand" : "neutral"}>
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {user.role === Role.OWNER ? (
                      <span className="text-xs text-slate-400">
                        All practices
                      </span>
                    ) : user.practices.length === 0 ? (
                      <Badge variant="amber">None assigned</Badge>
                    ) : (
                      <span className="text-xs">
                        {user.practices.map((p) => p.name).join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="text-xs font-medium text-brand-700 hover:text-brand-800"
                      >
                        Edit
                      </button>
                      {user.id === currentUserId ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleActive(user)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800"
                        >
                          {user.isActive ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title={editing ? "Edit user" : "Add user"}
        wide
      >
        <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={saving}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-password">
                {editing ? "New password (optional)" : "Password"}
              </Label>
              <SensitiveInput
                id="user-password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                disabled={saving}
                placeholder={editing ? "Leave blank to keep current" : ""}
              />
              <p className="text-xs text-slate-500">
                Minimum 8 characters. Spaces are not allowed.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select
                id="user-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                disabled={saving || editing?.id === currentUserId}
              >
                {Object.values(Role).map((value) => (
                  <option key={value} value={value}>
                    {roleLabels[value]}
                  </option>
                ))}
              </Select>
              {editing?.id === currentUserId ? (
                <p className="text-xs text-slate-500">
                  You cannot change your own role.
                </p>
              ) : null}
            </div>
          </div>

          {showPracticePicker ? (
            <div className="space-y-1.5">
              <Label htmlFor="user-practices">Assigned practices</Label>
              {practices.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No practices exist yet — create one first.
                </p>
              ) : (
                <div
                  id="user-practices"
                  className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2"
                >
                  {practices.map((practice) => (
                    <label
                      key={practice.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={practiceIds.has(practice.id)}
                        onChange={() => togglePractice(practice.id)}
                        disabled={saving}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                      {practice.name}
                      {!practice.isActive ? (
                        <span className="text-xs text-slate-400">
                          (inactive)
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">
                Controls which practices this user can see across every module.
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              Owners have access to every practice — no assignment needed.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              disabled={saving || editing?.id === currentUserId}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Active
          </label>

          {formError ? <FieldError>{formError}</FieldError> : null}
        </form>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setModalOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
