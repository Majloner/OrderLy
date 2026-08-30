import { Pencil, UserCheck, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAFF_ROLE_LABELS, type StaffMember } from "@/types";

// Roles on the semantic triples: owner carries the brand, waiter the info
// tone, kitchen the warm amber it had before — all AA-checked in global.css.
const roleBadgeClass: Record<StaffMember["role"], string> = {
  owner: "border-primary/40 bg-primary/10 text-primary",
  waiter: "border-info-border bg-info-fill text-info-fg",
  kitchen: "border-warning-border bg-warning-fill text-warning-fg",
};

interface StaffRowProps {
  member: StaffMember;
  // The signed-in owner's own row. Renaming yourself is allowed (the DB trigger
  // permits it), so the edit button stays enabled and the dialog hides the role
  // control instead. Only deactivation is disabled — the API and the trigger
  // both reject it, so offering it and then refusing would be theatre.
  isSelf: boolean;
  onEdit: (member: StaffMember) => void;
  onToggleActive: (member: StaffMember) => void;
}

export function StaffRow({ member, isSelf, onEdit, onToggleActive }: StaffRowProps) {
  const isActive = member.deactivated_at === null;
  // login before email: email is optional contact data now and may be absent,
  // while a staff member always has a login. Owners have the reverse.
  const displayName = member.full_name ?? member.login ?? member.email ?? "—";
  // What the owner dictates to the staff member, so it is worth showing even
  // when a full name exists.
  const secondary = member.login ?? member.email;

  return (
    <li className={cn("border-border bg-card flex items-start gap-3 rounded-lg border p-3", !isActive && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground font-medium">{displayName}</span>
          <Badge variant="outline" className={roleBadgeClass[member.role]}>
            {STAFF_ROLE_LABELS[member.role]}
          </Badge>
          {!isActive && (
            <Badge variant="outline" className="border-neutral-border bg-neutral-fill text-neutral-fg">
              Nieaktywny
            </Badge>
          )}
          {isSelf && <span className="text-muted-foreground text-xs">(to Ty)</span>}
        </div>
        {secondary && secondary !== displayName && (
          <p className="text-muted-foreground mt-1 truncate text-sm">{secondary}</p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Edytuj konto ${displayName}`}
          onClick={() => {
            onEdit(member);
          }}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", isActive ? "hover:text-destructive" : "hover:text-success-fg")}
          aria-label={`${isActive ? "Dezaktywuj" : "Aktywuj"} konto ${displayName}`}
          disabled={isSelf}
          onClick={() => {
            onToggleActive(member);
          }}
        >
          {isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
        </Button>
      </div>
    </li>
  );
}
