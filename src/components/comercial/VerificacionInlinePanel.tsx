import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { InlineVerifyBool, InlineVerifyEnum, InlineVerifyNumber } from "./InlineVerify";

const CLUSTERS = [
  "ultra_prime",
  "prime_value_add",
  "flex_living_core",
  "outer_distressed",
  "hospedaje",
  "coliving",
  "reposicionamiento_segunda_mano",
  "baja_prioridad",
];

export function VerificacionInlinePanel({ buildingId }: { buildingId: string }) {
  const [a, setA] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  const [propsN, setPropsN] = useState<number | null>(null);

  async function load() {
    const [ba, bld, ow] = await Promise.all([
      supabase.from("building_analysis").select("*").eq("building_id", buildingId).maybeSingle(),
      supabase.from("buildings").select("cluster_asignado, metadatos").eq("id", buildingId).maybeSingle(),
      supabase.from("building_owners").select("id", { count: "exact", head: true }).eq("building_id", buildingId),
    ]);
    setA(ba.data); setB(bld.data); setPropsN(ow.count ?? null);
  }
  useEffect(() => { load(); }, [buildingId]);

  const escaleras = a?.n_escaleras_final ?? a?.n_escaleras_en_piso01 ?? (a?.segundas_escaleras ? 2 : 1);
  const ventanasFachada = a?.ventanas_fachada_total;
  const ventanasPatio = a?.ventanas_patios_estimadas ?? a?.ventanas_patios_total;

  return (
    <Card>
      <CardHeader>
        <Eyebrow><ShieldCheck className="mr-1 inline h-3 w-3" /> Validación humana</Eyebrow>
        <CardTitle>Verifica los datos estimados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <InlineVerifyBool
          buildingId={buildingId}
          dimension="esquina"
          detector="corner-detector"
          campo="building_analysis.esquina"
          valorActual={a?.esquina}
          label="¿Es esquina?"
          trueLabel="Sí, es esquina"
          falseLabel="No, no es esquina"
          onDone={load}
        />
        <InlineVerifyNumber
          buildingId={buildingId}
          dimension="escaleras"
          detector="stair-detector"
          campo="building_analysis.n_escaleras_final"
          valorActual={escaleras}
          label="Nº cajas de escaleras (planta 1)"
          onDone={load}
        />
        <InlineVerifyNumber
          buildingId={buildingId}
          dimension="ventanas_fachada"
          detector="facade-window"
          campo="building_analysis.ventanas_fachada_total"
          valorActual={ventanasFachada}
          label="Ventanas en fachada (Street View)"
          onDone={load}
        />
        <InlineVerifyNumber
          buildingId={buildingId}
          dimension="ventanas_patio"
          detector="patio-window"
          campo="building_analysis.ventanas_patios_estimadas"
          valorActual={ventanasPatio}
          label="Ventanas a patio (Google Earth oblicua)"
          onDone={load}
        />
        <InlineVerifyBool
          buildingId={buildingId}
          dimension="proteccion"
          detector="proteccion"
          campo="building_analysis.protegido_historicamente"
          valorActual={a?.protegido_historicamente}
          label="¿Protegido históricamente / APE?"
          trueLabel="Sí, protegido"
          falseLabel="No, sin protección"
          onDone={load}
        />
        <InlineVerifyEnum
          buildingId={buildingId}
          dimension="cluster"
          detector="cluster"
          campo="buildings.cluster_asignado"
          valorActual={b?.cluster_asignado}
          label="Clasificación / tesis"
          opciones={CLUSTERS}
          onDone={load}
        />
        <InlineVerifyNumber
          buildingId={buildingId}
          dimension="propietarios"
          detector="propietarios"
          campo="building_owners.count"
          valorActual={propsN}
          label="Nº propietarios"
          onDone={load}
        />
        <p className="pt-2 text-[11px] text-muted-foreground">
          Cada verificación alimenta <span className="font-mono">qa_ground_truth</span> (fixture de regresión). Las correcciones lanzan un diagnóstico IA del <strong>método</strong> que falló.
        </p>
      </CardContent>
    </Card>
  );
}