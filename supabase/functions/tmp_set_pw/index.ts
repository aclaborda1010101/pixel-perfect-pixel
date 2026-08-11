import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const body = await req.json();
  if (body.token !== "K6ZzlAdG7Xr8wPSRXEEjlPjWrRLueT2X") return new Response("no", { status: 403 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = list?.users?.find((x: any) => (x.email || "").toLowerCase() === "carlos.moreno@afflux.es");
  if (!u) return new Response("missing", { status: 404 });
  const { error } = await admin.auth.admin.updateUserById(u.id, { password: String(body.password) });
  return new Response(JSON.stringify({ ok: !error, error: error?.message }), { headers: { "Content-Type": "application/json" } });
});
