// Temporal: crea/completa la cuenta del gestor comercial. Se elimina tras usarse.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    if (body.token !== Deno.env.get("TMP_SETUP_TOKEN")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email = "carlos.moreno@afflux.es";
    const password = String(body.password);
    let userId: string | null = null;
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((x: any) => (x.email || "").toLowerCase() === email);
    if (existing) {
      userId = existing.id;
      await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: "Carlos Moreno" },
      });
      if (error) throw error;
      userId = created.user!.id;
    }
    await admin.from("profiles").upsert(
      { id: userId, email, full_name: "Carlos Moreno", must_change_password: true },
      { onConflict: "id" },
    );
    await admin.from("user_roles").delete().eq("user_id", userId);
    await admin.from("user_roles").insert({ user_id: userId, role: "sales_manager" as any });
    return new Response(JSON.stringify({ ok: true, user_id: userId }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500 });
  }
});
