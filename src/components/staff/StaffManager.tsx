import { useState } from "react";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { callStaffApi, useStaff } from "@/components/hooks/useStaff";
import { StaffDialog } from "@/components/staff/StaffDialog";
import { StaffRow } from "@/components/staff/StaffRow";
import type { StaffCreateInput, StaffUpdateInput } from "@/lib/schemas/staff";
import type { StaffMember } from "@/types";

interface StaffManagerProps {
  // The signed-in owner's auth id, so their own row can disable the controls
  // the API and DB trigger would reject anyway.
  currentUserId: string;
}

export default function StaffManager({ currentUserId }: StaffManagerProps) {
  const { staff, loadError, refetch, reload } = useStaff();
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editedMember, setEditedMember] = useState<StaffMember | null>(null);
  const [confirm, setConfirm] = useState<StaffMember | null>(null);

  // A failed refetch after a successful mutation degrades to actionError so the
  // rendered list stays on screen.
  if (!staff) {
    if (loadError) {
      return <ErrorPanel message={loadError} onRetry={reload} />;
    }
    return <p className="text-white/60">Ładowanie listy personelu…</p>;
  }

  const openCreate = () => {
    setEditedMember(null);
    setActionError(null);
    setDialogOpen(true);
  };

  const openEdit = (member: StaffMember) => {
    setEditedMember(member);
    setActionError(null);
    setDialogOpen(true);
  };

  // Dialog submits deliberately do NOT catch: the rejection propagates to the
  // dialog, which renders it inline and stays open with the entered values.
  const createMember = async (input: StaffCreateInput) => {
    await callStaffApi("POST", "/api/staff", input);
    await refetch();
  };

  const updateMember = async (member: StaffMember, input: StaffUpdateInput) => {
    await callStaffApi("PUT", `/api/staff/${member.user_id}`, input);
    await refetch();
  };

  const handleConfirm = async () => {
    if (!confirm) {
      return;
    }
    const wasActive = confirm.deactivated_at === null;
    try {
      // Only `active` — restating full_name/role from this cached row would
      // revert a rename or role change made from another tab.
      await callStaffApi("PUT", `/api/staff/${confirm.user_id}`, { active: !wasActive });
      await refetch();
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Nie udało się zmienić statusu konta");
    } finally {
      setConfirm(null);
    }
  };

  const confirmWasActive = confirm?.deactivated_at === null;
  const confirmName = confirm?.full_name ?? confirm?.login ?? confirm?.email ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" onClick={openCreate}>
          <Plus className="size-4" /> Dodaj pracownika
        </Button>
      </div>

      {actionError && <ErrorPanel message={actionError} />}

      {/* The owner's own profile is always in the list, so "empty" means no
          staff have been added yet. */}
      {staff.length <= 1 && (
        <EmptyState message="Nie masz jeszcze kont personelu.">
          <Button type="button" className="mt-4" onClick={openCreate}>
            <Plus className="size-4" /> Dodaj pierwszego pracownika
          </Button>
        </EmptyState>
      )}

      <ul className="space-y-2">
        {staff.map((member) => (
          <StaffRow
            key={member.user_id}
            member={member}
            isSelf={member.user_id === currentUserId}
            onEdit={openEdit}
            onToggleActive={setConfirm}
          />
        ))}
      </ul>

      <StaffDialog
        open={dialogOpen}
        member={editedMember}
        isSelf={editedMember?.user_id === currentUserId}
        onOpenChange={setDialogOpen}
        onCreate={createMember}
        onUpdate={updateMember}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmWasActive ? `Dezaktywować konto „${confirmName}”?` : `Aktywować konto „${confirmName}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmWasActive
                ? "Pracownik straci dostęp do systemu przy następnym żądaniu. Konto zostaje — możesz je później aktywować ponownie."
                : "Pracownik odzyska dostęp do systemu i będzie mógł zalogować się swoim dotychczasowym hasłem."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>
              {confirmWasActive ? "Dezaktywuj" : "Aktywuj"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
