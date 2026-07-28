declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    company_id: string | null;
    role: import("@/types").StaffRole | null;
    supabase: ReturnType<typeof import("@/lib/supabase").createClient>;
  }
}
