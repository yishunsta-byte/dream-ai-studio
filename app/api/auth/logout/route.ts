import { createSupabaseServer } from "@/lib/auth/server";

export async function POST() {
  const supabase = await createSupabaseServer();
  if (supabase) await supabase.auth.signOut();
  return Response.json({ ok: true });
}
