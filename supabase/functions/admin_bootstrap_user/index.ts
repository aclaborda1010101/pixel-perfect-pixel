// Temporal: alta/actualización idempotente de un usuario admin. Protegida por TEMP_BOOTSTRAP_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bootstrap-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const key = Deno.env.get("TEMP_BOOTSTRAP_KEY");
  if (!key || req.headers.get("x-bootstrap-key") !== key) return j({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    const email = String(body.email ?? "").toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "");
    const role = String(body.role ?? "");
    if (!email || !password || !role) return j({ error: "bad request" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const found = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (found.error) throw found.error;
    const matches = (found.data?.users ?? []).filter((u: any) => (u.email || "").toLowerCase() === email);
    let userId: string;
    let action: string;
    if (matches.length > 1) return j({ error: "duplicated", count: matches.length }, 409);
    if (matches.length === 1) {
      userId = matches[0].id;
      action = "updated";
      const up = await admin.auth.admin.updateUserById(userId, {
        password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (up.error) throw up.error;
    } else {
      const cr = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (cr.error) throw cr.error;
      userId = cr.data.user!.id;
      action = "created";
    }

    await admin.from("profiles").upsert(
      { id: userId, email, full_name: fullName, must_change_password: true },
      { onConflict: "id" },
    );
    await admin.from("user_roles").delete().eq("user_id", userId);
    const ins = await admin.from("user_roles").insert({ user_id: userId, role });
    if (ins.error) throw ins.error;

    const chk = await admin.auth.admin.getUserById(userId);
    const prof = await admin.from("profiles").select("full_name,email,must_change_password").eq("id", userId).maybeSingle();
    const roles = await admin.from("user_roles").select("role").eq("user_id", userId);

    return j({
      ok: true, action, user_id: userId,
      email_confirmed_at: chk.data?.user?.email_confirmed_at ?? null,
      profile: prof.data, roles: (roles.data ?? []).map((r: any) => r.role),
    });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
