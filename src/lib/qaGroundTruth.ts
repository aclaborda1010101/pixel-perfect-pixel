import { supabase } from "@/integrations/supabase/client";

/**
 * Mapping dimension -> (qa_ground_truth column, value coercion).
 * Allows verifications from inline UI or free-form feedback to land as
 * regression fixtures in qa_ground_truth.
 */
const DIMENSION_TO_GT_COLUMN: Record<string, { col: string; coerce: (v: unknown) => unknown }> = {
  escaleras: { col: "escaleras", coerce: (v) => Number(v) },
  propietarios: { col: "propietarios", coerce: (v) => Number(v) },
  viviendas: { col: "n_viv", coerce: (v) => Number(v) },
  m2: { col: "m2_tot", coerce: (v) => Number(v) },
  esquina: { col: "es_esquina", coerce: (v) => Boolean(v) },
  ventanas_fachada: { col: "ventanas_fachada", coerce: (v) => Number(v) },
  ventanas_patio: { col: "ventanas_patio", coerce: (v) => Number(v) },
  cluster: { col: "cluster_label", coerce: (v) => String(v) },
  proteccion: { col: "protegido", coerce: (v) => Boolean(v) },
};

export type UpsertGtArgs = {
  buildingId: string;
  dimension: string;
  valorHumano: unknown;
  fuente: "verificacion_inline" | "feedback_libre" | "override_aplicado";
  verificadoPor?: string | null;
};

export async function upsertGroundTruth({ buildingId, dimension, valorHumano, fuente, verificadoPor }: UpsertGtArgs) {
  const map = DIMENSION_TO_GT_COLUMN[dimension];
  if (!map) return { skipped: true as const, reason: `no GT column for dimension=${dimension}` };

  const patch: Record<string, unknown> = {
    [map.col]: map.coerce(valorHumano),
    verificado_por: verificadoPor ?? null,
    verificado_at: new Date().toISOString(),
    fuente_verificacion: fuente,
  };

  // Try update first; if no row, insert one keyed by building_id.
  const { data: existing } = await supabase
    .from("qa_ground_truth")
    .select("id")
    .eq("building_id", buildingId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from("qa_ground_truth").update(patch as any).eq("id", existing.id);
    if (error) return { skipped: false as const, error: error.message };
    return { skipped: false as const, id: existing.id };
  }

  const { data: ins, error } = await supabase
    .from("qa_ground_truth")
    .insert([{ building_id: buildingId, lista: "verificacion_humana", direccion_raw: "", direccion_norm: "", ...patch } as any])
    .select("id")
    .single();
  if (error) return { skipped: false as const, error: error.message };
  return { skipped: false as const, id: ins?.id };
}