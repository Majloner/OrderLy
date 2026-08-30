import { Pencil, UserCheck, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAFF_ROLE_LABELS, type StaffMember } from "@/types";

const roleBadgeClass: Record<StaffMember["role"], string> = {
  owner: "border-purple-400/40 bg-purple-500/15 text-purple-200",
  waiter: "border-blue-400/40 bg-blue-500/15 text-blue-200",
  kitchen: "border-amber-400/40 bg-amber-500/15 text-amber-200",
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
          <span className="font-medium text-white">{displayName}</span>
          <Badge variant="outline" className={roleBadgeClass[member.role]}>
            {STAFF_ROLE_LABELS[member.role]}
          </Badge>
          {!isActive && (
            <Badge variant="outline" className="border-neutral-border bg-neutral-fill text-neutral-fg">
              Nieaktywny
            </Badge>
          )}
          {isSelf && <span className="text-xs text-white/40">(to Ty)</span>}
        </div>
        {secondary && secondary !== displayName && <p className="mt-1 truncate text-sm text-white/50">{secondary}</p>}
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-white/60 hover:text-white"
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
          className={cn("text-white/60", isActive ? "hover:text-red-300" : "hover:text-green-300")}
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
