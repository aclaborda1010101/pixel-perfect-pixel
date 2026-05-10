import { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mapa ruta → import() del chunk lazy. Vite dedupe la promesa, así que
 * llamar a esto en mouseEnter "calienta" el chunk sin coste extra si ya está.
 */
const chunkLoaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Dashboard"),
  "/edificios": () => import("@/pages/Buildings"),
  "/propietarios": () => import("@/pages/Owners"),
  "/inversores": () => import("@/pages/Investors"),
  "/activos": () => import("@/pages/Assets"),
  "/llamadas": () => import("@/pages/Calls"),
  "/leads": () => import("@/pages/Leads"),
  "/notas-simples": () => import("@/pages/NotasSimples"),
  "/mensajes": () => import("@/pages/Mensajes"),
  "/next-actions": () => import("@/pages/NextActions"),
  "/productividad": () => import("@/pages/Productividad"),
  "/asistente": () => import("@/pages/Assistant"),
  "/ajustes": () => import("@/pages/Settings"),
};

/**
 * Prefetchers de DATOS por ruta. Cada uno mete en el cache de react-query
 * exactamente la misma key que usará la página al montarse, de modo que
 * cuando el usuario hace click la primera consulta es un cache hit.
 *
 * Si un prefetcher no existe para esa ruta, sólo precalentamos el chunk.
 */
const dataPrefetchers: Record<string, (qc: QueryClient) => Promise<unknown> | void> = {
  "/": (qc) =>
    qc.prefetchQuery({
      queryKey: ["dashboard:overview"],
      queryFn: async () => {
        const [a, b, c, h, r, bld, own, comp, cal, calAna, hcal, hnot, htsk] = await Promise.all([
          supabase.from("calls").select("id", { count: "exact", head: true }).is("resumen", null),
          supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
          supabase.from("owners").select("id", { count: "exact", head: true }).eq("rol", "desconocido"),
          supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("origen", "pipeline_hygiene").eq("estado", "pendiente"),
          supabase.from("calls").select("id, fecha, duracion_seg, resumen, owner_id, owners(nombre)")
            .order("fecha", { ascending: false }).limit(6),
          supabase.from("buildings").select("id", { count: "exact", head: true }),
          supabase.from("owners").select("id", { count: "exact", head: true }),
          supabase.from("companies" as any).select("id", { count: "exact", head: true }),
          supabase.from("calls").select("id", { count: "exact", head: true }),
          supabase.from("calls").select("id", { count: "exact", head: true }).not("transcripcion", "is", null).neq("transcripcion", ""),
          supabase.from("hubspot_calls").select("id", { count: "exact", head: true }),
          supabase.from("hubspot_notes").select("id", { count: "exact", head: true }),
          supabase.from("hubspot_tasks").select("id", { count: "exact", head: true }),
        ]);
        return {
          k: { pendingAnalysis: a.count ?? 0, pendingActions: b.count ?? 0, uncataloged: c.count ?? 0, hygieneIssues: h.count ?? 0 },
          recent: r.data ?? [],
          sync: {
            buildings: bld.count ?? 0, owners: own.count ?? 0, companies: comp.count ?? 0,
            calls: cal.count ?? 0, callsAnalizables: calAna.count ?? 0,
            hsCalls: hcal.count ?? 0, hsNotes: hnot.count ?? 0, hsTasks: htsk.count ?? 0,
          },
        };
      },
    }),

  "/inversores": (qc) =>
    qc.prefetchQuery({
      queryKey: ["inversores", { search: "", tipo: "all", persona: "all", orden: "recent", page: 0, pageSize: 50 }],
      queryFn: async () => {
        const { data } = await supabase.rpc("rpc_inversores_paginated", {
          p_search: null, p_tipo: null, p_buyer_persona: null, p_distrito: null,
          p_order: "recent", p_limit: 50, p_offset: 0,
        } as any);
        return data ?? [];
      },
    }),
};

const inflight = new Set<string>();

/** Llamar en onMouseEnter / onFocus de un NavLink. Idempotente y muy barato. */
export function prefetchRoute(path: string, qc: QueryClient) {
  if (inflight.has(path)) return;
  inflight.add(path);
  try {
    chunkLoaders[path]?.();
    dataPrefetchers[path]?.(qc);
  } catch {
    // silencioso: el prefetch nunca debe romper la UI
  }
}