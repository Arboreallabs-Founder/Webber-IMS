"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ROLE_CHOICES, roleChoiceOf, roleLabel, type Role } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import { createUser, updateUser, type ActionResult } from "./actions";

type AppUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_factory_admin: boolean;
  is_active: boolean;
  created_at: string;
};

const ROLE_OPTIONS = ROLE_CHOICES;

export function UsersManager({ users }: { users: AppUser[] }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<AppUser | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const filteredUsers = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (u.full_name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || roleLabel(u).toLowerCase().includes(q);
  });

  async function run(action: (fd: FormData) => Promise<ActionResult>, form: HTMLFormElement, onOk: () => void) {
    setPending(true);
    setError(null);
    const res = await action(new FormData(form));
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onOk();
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, email, or role…" />
        <p className="text-sm text-muted-foreground">{filteredUsers.length} of {users.length}</p>
        <Button className="ml-auto" onClick={() => { setError(null); setCreating(true); }}>
          <Plus className="size-4" /> Add user
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-16 text-right">Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No matches.</TableCell></TableRow>
          ) : filteredUsers.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
              <TableCell><Badge>{roleLabel(u)}</Badge></TableCell>
              <TableCell>
                {u.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => { setError(null); setEditing(u); }} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Create user */}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Add user" description="Provisions a sign-in (no email verification needed).">
        <form
          onSubmit={(e) => { e.preventDefault(); run(createUser, e.currentTarget, () => setCreating(false)); }}
          className="space-y-4"
        >
          <Field label="Full name"><Input name="full_name" required /></Field>
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Field label="Temporary password"><Input name="password" type="text" minLength={6} required placeholder="min 6 characters" /></Field>
          <Field label="Role">
            <Select name="role" defaultValue="team_member">
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <FormFooter error={error} pending={pending} onCancel={() => setCreating(false)} />
        </form>
      </Dialog>

      {/* Edit user */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit user" description={editing?.email}>
        {editing && (
          <form
            onSubmit={(e) => { e.preventDefault(); run(updateUser, e.currentTarget, () => setEditing(null)); }}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={editing.id} />
            <Field label="Full name"><Input name="full_name" defaultValue={editing.full_name ?? ""} /></Field>
            <Field label="Role">
              <Select name="role" defaultValue={roleChoiceOf(editing)}>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="is_active" defaultChecked={editing.is_active} className="size-4 rounded border-input" />
              <span className="text-sm font-medium">Active (can sign in)</span>
            </label>
            <FormFooter error={error} pending={pending} onCancel={() => setEditing(null)} />
          </form>
        )}
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function FormFooter({ error, pending, onCancel }: { error: string | null; pending: boolean; onCancel: () => void }) {
  return (
    <>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={pending}>Save</Button>
      </div>
    </>
  );
}
