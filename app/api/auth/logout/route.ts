import { requireApiAuth } from "@/lib/auth/api";
import { createSupabaseServer } from "@/lib/auth/server";

export async function POST(){
 const denied=await requireApiAuth();if(denied)return denied;

  const supabase = await createSupabaseServer();
  if (supabase) await supabase.auth.signOut();
  return Response.json({ ok: true });
}
