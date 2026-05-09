import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type NotaSimple = {
  id: string;
  building_id: string | null;
  owner_id: string | null;
  file_url: string | null;
  status: "pendiente" | "procesando" | "listo" | "error" | string;
  riesgo: "alto" | "medio" | "bajo" | null;
  raw_pdf_text: string | null;
  structured_json: any | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

export type NotaSimpleEnriched = NotaSimple & {
  building?: { id: string; direccion: string | null; ciudad: string | null } | null;
  owner?: { id: string; nombre: string | null } | null;
};

export function useNotasSimples() {
  const [items, setItems] = useState<NotaSimpleEnriched[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notas_simples")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const notas = (data ?? []) as NotaSimple[];

    const buildingIds = Array.from(new Set(notas.map(n => n.building_id).filter(Boolean))) as string[];
    const ownerIds = Array.from(new Set(notas.map(n => n.owner_id).filter(Boolean))) as string[];

    const [buildings, owners] = await Promise.all([
      buildingIds.length
        ? supabase.from("buildings").select("id, direccion, ciudad").in("id", buildingIds)
        : Promise.resolve({ data: [] as any[] }),
      ownerIds.length
        ? supabase.from("owners").select("id, nombre").in("id", ownerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const bMap = new Map((buildings.data ?? []).map((b: any) => [b.id, b]));
    const oMap = new Map((owners.data ?? []).map((o: any) => [o.id, o]));

    setItems(notas.map(n => ({
      ...n,
      building: n.building_id ? (bMap.get(n.building_id) ?? null) : null,
      owner: n.owner_id ? (oMap.get(n.owner_id) ?? null) : null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime: re-fetch on cualquier change
  useEffect(() => {
    const ch = supabase
      .channel(`notas_simples_rt_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notas_simples" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const upload = useCallback(async (
    file: File,
    building_id: string | null,
    owner_id: string | null,
  ) => {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      throw new Error("Solo se admiten archivos PDF");
    }
    const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage.from("notas-simples").upload(path, file, {
      contentType: "application/pdf", upsert: false,
    });
    if (up.error) throw new Error(up.error.message);

    const { data: nota, error: insErr } = await supabase
      .from("notas_simples")
      .insert({ file_url: path, building_id, owner_id, status: "pendiente" })
      .select("*").single();
    if (insErr || !nota) throw new Error(insErr?.message ?? "Error creando nota");

    // disparar análisis (no bloqueamos)
    supabase.functions.invoke("analyze_nota_simple", {
      body: { nota_simple_id: nota.id },
    }).then(({ error }) => {
      if (error) console.warn("analyze invoke error", error.message);
    });

    return nota.id as string;
  }, []);

  const reanalyze = useCallback(async (id: string) => {
    await supabase.from("notas_simples").update({
      status: "pendiente", error_message: null,
    }).eq("id", id);
    const { error } = await supabase.functions.invoke("analyze_nota_simple", {
      body: { nota_simple_id: id },
    });
    if (error) throw new Error(error.message);
  }, []);

  return useMemo(() => ({ items, loading, load, upload, reanalyze }), [items, loading, load, upload, reanalyze]);
}

export function useNotaSimple(id: string | undefined) {
  const [nota, setNota] = useState<NotaSimpleEnriched | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("notas_simples").select("*").eq("id", id).maybeSingle();
    if (error || !data) { setNota(null); setLoading(false); return; }
    const n = data as NotaSimple;

    const [b, o, signed] = await Promise.all([
      n.building_id
        ? supabase.from("buildings").select("id, direccion, ciudad").eq("id", n.building_id).maybeSingle()
        : Promise.resolve({ data: null }),
      n.owner_id
        ? supabase.from("owners").select("id, nombre").eq("id", n.owner_id).maybeSingle()
        : Promise.resolve({ data: null }),
      n.file_url
        ? supabase.storage.from("notas-simples").createSignedUrl(n.file_url, 60 * 30)
        : Promise.resolve({ data: null }),
    ]);
    setNota({ ...n, building: (b as any).data ?? null, owner: (o as any).data ?? null });
    setPdfUrl((signed as any)?.data?.signedUrl ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`nota_simple_${id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "notas_simples", filter: `id=eq.${id}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  const reanalyze = useCallback(async () => {
    if (!id) return;
    await supabase.from("notas_simples").update({
      status: "pendiente", error_message: null,
    }).eq("id", id);
    const { error } = await supabase.functions.invoke("analyze_nota_simple", {
      body: { nota_simple_id: id },
    });
    if (error) throw new Error(error.message);
  }, [id]);

  return { nota, pdfUrl, loading, reanalyze, reload: load };
}