declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    company_id: string | null;
    role: "owner" | "waiter" | "kitchen" | null;
  }
}
