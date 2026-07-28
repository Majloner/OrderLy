import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MIN_STAFF_PASSWORD_LENGTH,
  staffCreateInputSchema,
  staffUpdateInputSchema,
  type StaffCreateInput,
  type StaffUpdateInput,
} from "@/lib/schemas/staff";
import { STAFF_ASSIGNABLE_ROLES, STAFF_ROLE_LABELS, type AssignableStaffRole, type StaffMember } from "@/types";

interface StaffDialogProps {
  open: boolean;
  // null = create mode, non-null = edit mode.
  member: StaffMember | null;
  // Editing your own row: rename is allowed, changing your own role is not.
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: StaffCreateInput) => Promise<void>;
  onUpdate: (member: StaffMember, input: StaffUpdateInput) => Promise<void>;
}

export function StaffDialog({ open, member, isSelf, onOpenChange, onCreate, onUpdate }: StaffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member ? "Edytuj pracownika" : "Nowy pracownik"}</DialogTitle>
          <DialogDescription>
            {!member && "Hasło przekaż pracownikowi osobiście — system nie wysyła e-maili."}
            {member && isSelf && "Możesz zmienić swoje imię i nazwisko. Własnej roli nie można zmienić."}
            {member && !isSelf && "Adresu e-mail i hasła nie można zmienić."}
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form state resets on
            every open without an effect. */}
        <StaffForm
          member={member}
          isSelf={isSelf}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface StaffFormProps {
  member: StaffMember | null;
  isSelf: boolean;
  onCreate: (input: StaffCreateInput) => Promise<void>;
  onUpdate: (member: StaffMember, input: StaffUpdateInput) => Promise<void>;
  onDone: () => void;
}

function StaffForm({ member, isSelf, onCreate, onUpdate, onDone }: StaffFormProps) {
  const [email, setEmail] = useState(member?.email ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(member?.full_name ?? "");
  const [role, setRole] = useState<AssignableStaffRole>(member?.role === "kitchen" ? "kitchen" : "waiter");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Edit sends only the fields this form owns. `active` is deliberately
    // omitted: activation is the row's own action, and restating it from this
    // form's possibly-stale copy would resurrect a member deactivated elsewhere.
    // Self-edit omits `role` too — the API and the DB trigger both reject it.
    const parsed = member
      ? staffUpdateInputSchema.safeParse(isSelf ? { full_name: fullName } : { full_name: fullName, role })
      : staffCreateInputSchema.safeParse({ email, password, full_name: fullName, role });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (member) {
        await onUpdate(member, parsed.data);
      } else {
        await onCreate(parsed.data as StaffCreateInput);
      }
      onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać pracownika");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {!member && (
        <>
          <div className="space-y-2">
            <Label htmlFor="staff-email">Adres e-mail</Label>
            <Input
              id="staff-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              placeholder="kelner@twojlokal.pl"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-password">Hasło tymczasowe</Label>
            {/* autoComplete="new-password": without it the browser offers to
                save the STAFF member's temporary password against the owner's
                own OrderLY login, and may autofill it there later. */}
            <Input
              id="staff-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              placeholder={`Co najmniej ${MIN_STAFF_PASSWORD_LENGTH} znaków`}
              autoComplete="new-password"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="staff-name">Imię i nazwisko</Label>
        <Input
          id="staff-name"
          value={fullName}
          onChange={(event) => {
            setFullName(event.target.value);
          }}
          placeholder="np. Anna Kowalska"
          autoFocus={member !== null}
        />
      </div>

      {/* Hidden when editing yourself: the role is not yours to change. */}
      <div className={isSelf && member ? "hidden" : "space-y-2"}>
        <Label htmlFor="staff-role">Rola</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value as AssignableStaffRole);
          }}
        >
          <SelectTrigger id="staff-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAFF_ASSIGNABLE_ROLES.map((assignable) => (
              <SelectItem key={assignable} value={assignable}>
                {STAFF_ROLE_LABELS[assignable]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Anuluj
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </Button>
      </DialogFooter>
    </form>
  );
}
