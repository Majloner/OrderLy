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
  // The signed-in owner's own row: the API and the DB trigger both reject role
  // changes and self-deactivation, so the controls are disabled rather than
  // offered and then refused.
  isSelf: boolean;
  onEdit: (member: StaffMember) => void;
  onToggleActive: (member: StaffMember) => void;
}

export function StaffRow({ member, isSelf, onEdit, onToggleActive }: StaffRowProps) {
  const isActive = member.deactivated_at === null;
  const displayName = member.full_name ?? member.email;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3",
        !isActive && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-white">{displayName}</span>
          <Badge variant="outline" className={roleBadgeClass[member.role]}>
            {STAFF_ROLE_LABELS[member.role]}
          </Badge>
          {!isActive && (
            <Badge variant="outline" className="border-white/20 bg-white/10 text-white/60">
              Nieaktywny
            </Badge>
          )}
          {isSelf && <span className="text-xs text-white/40">(to Ty)</span>}
        </div>
        {member.full_name && <p className="mt-1 truncate text-sm text-white/50">{member.email}</p>}
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-white/60 hover:text-white"
          aria-label={`Edytuj konto ${displayName}`}
          disabled={isSelf}
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
