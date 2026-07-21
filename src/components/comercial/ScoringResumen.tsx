import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ScoreGauge, scoreTier, tierBarClass, tierTextClass, getDisplayScore, scoreModeLabel } from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Sparkles,
  MapPin,
} from "lucide-react";

type ClusterKey =
  | "ultra_prime"
  | "prime_value_add"
  | "flex_living_core"
  | "outer_distressed"
  | "outer_distressed_selectivo"
  | "baja_prioridad"
  | string;

const CLUSTER_LABELS: Record<string, { label: string; tagline: string; color: string }> = {
  ultra_prime: {
    label: "Ultra Prime",
    tagline: "Salida institucional · prima tamaño grande y ratios altos",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  prime_value_add: {
    label: "Prime Value-Add",
    tagline: "Reforma + reventa · prima ratio m²/viv y consolidación de propietarios",
    color: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  },
  flex_living_core: {
    label: "Flex Living Core",
    tagline: "Coliving / flex · prima viviendas pequeñas y ventanas para segregar",
    color: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  },
  outer_distressed: {
    label: "Outer Distressed",
    tagline: "Oportunidad por mala gestión · prima descuento y nº propietarios",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  outer_distressed_selectivo: {
    label: "Outer Distressed (selectivo)",
    tagline: "Compra puntual · selección fina por mala gestión",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  baja_prioridad: {
    label: "Baja prioridad",
    tagline: "Fuera de tesis principal · revisar caso a caso",
    color: "bg-muted text-muted-foreground border-border-faint",
  },
};

function num(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function plural(n: number, sing: string, plur: string) {
  return n === 1 ? `1 ${sing}` : `${n} ${plur}`;
}

/** Devuelve el reasoning textual generado por la IA para una métrica concreta. */
function reasonFor(an: any | null, key: string): { reasoning?: string; confidence?: number; sources?: string[] } | null {
  const det = an?.metricas_detalle?.[key];
  if (!det || typeof det !== "object") return null;
  return {
    reasoning: typeof det.reasoning === "string" ? det.reasoning : undefined,
    confidence: typeof det.confidence === "number" ? det.confidence : undefined,
    sources: Array.isArray(det.source) ? det.source : undefined,
  };
}

function confTxt(c?: number) {
  if (typeof c !== "number") return "";
  return ` _(confianza ${(c * 100).toFixed(0)}%)_`;
}

/**
 * Compone la narrativa de por qué este edificio tiene este scoring.
 * Texto descriptivo en párrafos (no bullets), explicando POR QUÉ la IA
 * detectó cada característica a partir del plano y de qué planta/fuente lo dedujo.
 */
function buildNarrative(b: any, an: any | null, s: any): string[] {
  const parts: string[] = [];
  const md = b?.metadatos ?? {};
  const cluster: string = b?.cluster_asignado ?? "baja_prioridad";
  const clusterInfo = CLUSTER_LABELS[cluster] ?? CLUSTER_LABELS.baja_prioridad;
  const barrio = md?.barrios_completos__clonada_ ?? md?.barrio ?? null;
  const distrito = md?.distrito ?? null;
  const score = Number(s?.score ?? b?.score ?? 0);

  // 1) Ubicación + cluster + EXPLICACIÓN del cluster (clave: por qué baja_prioridad pese a score alto)
  const ubic = barrio
    ? `en **${barrio}**${distrito ? ` (${distrito})` : ""}`
    : distrito
    ? `en el distrito **${distrito}**`
    : "sin barrio asignado en HubSpot";
  let frase1 = `Edificio ${ubic}, clasificado dentro de la tesis **${clusterInfo.label}** porque ${clusterInfo.tagline.toLowerCase()}.`;
  if (cluster === "baja_prioridad") {
    frase1 +=
      ` Aunque el scoring numérico ronda los **${score.toFixed(0)} puntos**, este edificio cae en _baja prioridad_ porque su barrio` +
      (barrio ? ` (${barrio})` : " (no informado en HubSpot)") +
      ` no figura en el mapa de clusters de tesis Madrid (Ultra Prime, Prime Value-Add, Flex Living Core, Outer Distressed). En esa situación aplicamos pesos genéricos y conviene revisarlo caso a caso antes de descartarlo.`;
  } else {
    frase1 += ` Con un score de **${score.toFixed(0)}/100**, queda dentro del rango operativo de esta tesis.`;
  }
  parts.push(frase1);

  // 2) Composición física (m² + viviendas + ratio + propietarios + DH) — en prosa
  const m2 = num(s?.m2_total);
  const viv = num(s?.num_viviendas);
  const ratio = m2 && viv ? m2 / viv : null;
  const owners = num(s?.owners_count) ?? 0;
  const dh = b?.division_horizontal;
  const dhTxt = dh ? "ya tiene división horizontal constituida" : "**no tiene división horizontal**";
  const compFrag: string[] = [];
  if (m2) compFrag.push(`${m2.toLocaleString()} m² construidos`);
  if (viv) compFrag.push(plural(viv, "vivienda", "viviendas"));
  if (ratio) compFrag.push(`un ratio medio de **${ratio.toFixed(0)} m²/vivienda**`);
  if (compFrag.length) {
    parts.push(
      `Según los datos cruzados con HubSpot y Catastro, cuenta con ${compFrag.join(", ")}. ` +
      `Hay ${plural(owners, "propietario registrado", "propietarios registrados")} y ${dhTxt}, lo que ${
        owners >= 5
          ? "encaja con la tesis de consolidación de propietarios"
          : owners >= 2
          ? "facilita una negociación de bloque relativamente acotada"
          : "apunta a un propietario único, ideal para acuerdo directo"
      }.`
    );
  }

  // 3) Análisis del plano: cada métrica como párrafo razonado citando reasoning de la IA
  if (!an) {
    parts.push(
      `_Análisis IA del plano todavía pendiente. Subiendo el FXCC catastral se enriquecerá el scoring con detección automática de escaleras, patios, ventanas y potencial de elevación._`
    );
    return parts;
  }

  // --- Escaleras (CRÍTICO: razonado SIEMPRE sobre PISO 01, no planta baja) ---
  const escPiso01 = num(an?.n_escaleras_en_piso01);
  const escPB = num(an?.n_escaleras_en_planta_baja);
  if (escPiso01 !== null) {
    const r = reasonFor(an, "n_escaleras_en_piso01");
    let frase = `Sobre el **plano de la primera planta (PISO 01)** —que es donde la normativa Madrid exige evaluar el número real de cajas de escalera, porque en planta baja las escaleras suelen comunicar únicamente accesos comunes y no son indicador fiable— la IA ha identificado **${escPiso01} ${escPiso01 === 1 ? "caja ESC" : "cajas ESC independientes"}**`;
    if (escPB !== null && escPB !== escPiso01) {
      frase += ` (en planta baja se ven ${escPB}, pero esa cifra no se usa para la decisión)`;
    }
    frase += `. ${
      r?.reasoning
        ? `Razonamiento del modelo: "${r.reasoning}"`
        : escPiso01 >= 2
        ? "Se han localizado dos núcleos verticales claramente separados, sin comunicación espacial entre sí."
        : "Solo se observa un único núcleo vertical en la planta tipo."
    }${confTxt(r?.confidence)}.`;
    if (escPiso01 >= 2) {
      frase += ` Esto es **muy relevante** porque cumple el requisito de doble evacuación necesario para un cambio de uso a hotelero o coliving en Madrid.`;
    }
    parts.push(frase);
  }

  // --- Ventanas a fachada ---
  const vent = num(an?.ventanas_fachada_total);
  if (vent !== null) {
    const r = reasonFor(an, "ventanas_fachada_total");
    const fach = num(an?.fachada_lineal_total_m);
    let frase = `En cuanto a la fachada, se han contado **${vent} ventanas exteriores** revisando las 4 vistas de Street View (norte, este, sur, oeste)${
      fach ? ` sobre una fachada lineal estimada de ${Math.round(fach)} m` : ""
    }. ${
      r?.reasoning
        ? `El modelo lo justifica así: "${r.reasoning}"`
        : "El conteo se hace ventana a ventana, sin extrapolar geométricamente, y se capa al rango plausible 0-200."
    }${confTxt(r?.confidence)}.`;
    if (vent >= 50) {
      frase += ` Con más de 50 ventanas a fachada, el edificio tiene **alta segregabilidad**: permite muchas estancias exteriores y, por tanto, más unidades reposicionables.`;
    }
    parts.push(frase);
  }

  // --- Ventanas a patio (fórmula) ---
  const ventPatio = num(an?.ventanas_patios_total);
  const nPatios = num(an?.patios_detectados);
  if (ventPatio !== null && nPatios !== null && nPatios > 0) {
    const r = reasonFor(an, "ventanas_patios_total");
    const formula = typeof an?.formula_ventanas_patio === "string" ? an.formula_ventanas_patio : null;
    let frase = `Hacia el interior, la IA ha detectado **${nPatios} ${nPatios === 1 ? "patio" : "patios"}** sobre el plano del PISO 01 (los patios son verticales y se repiten en todas las plantas tipo), contrastando con la vista cenital satélite para no confundir con balcones exteriores. A partir de las paredes visibles de cada patio se proyecta **1 ventana por pared y planta** (cocina/baño/dormitorio interior), lo que da una estimación de **${ventPatio} ventanas a patio**. ${
      r?.reasoning ? `Detalle del razonamiento: "${r.reasoning}"` : ""
    }${confTxt(r?.confidence)}.`;
    if (formula) frase += ` _Fórmula aplicada:_ ${formula}`;
    parts.push(frase);
  }

  // --- Elevación ---
  const lev = num(an?.plantas_levantables);
  if (lev !== null && lev >= 1) {
    const r = reasonFor(an, "plantas_levantables");
    const vis = an?.plantas_visibles;
    const maxN = an?.plantas_max_normativa;
    parts.push(
      `Existe **potencial de elevación de ${lev} ${lev === 1 ? "planta" : "plantas"}**: el edificio tiene hoy ${vis ?? "?"} plantas sobre rasante y la normativa Madrid (en función del ancho de calle estimado) permite hasta ${maxN ?? "?"}. ${
        r?.reasoning ?? "El cálculo cruza el ancho de calle visible en Street View con la tabla de alturas máximas del PGOU."
      }${confTxt(r?.confidence)}.`
    );
  }

  // --- Esquina ---
  if (an?.esquina === true) {
    const r = reasonFor(an, "esquina");
    parts.push(
      `Hace **esquina**: ${
        r?.reasoning ?? "se confirma doble fachada cruzando la vista satélite cenital con las 4 vistas de Street View."
      }${confTxt(r?.confidence)} Esto maximiza ventanas exteriores y luz natural, muy valorado para reposicionamiento residencial premium u hotelero.`
    );
  }

  // --- Histórico / debilidades ---
  const debilidades: string[] = [];
  if (an?.protegido_historicamente) {
    const r = reasonFor(an, "protegido_historicamente");
    debilidades.push(
      `posible **protección histórica** (${r?.reasoning ?? "fachada con elementos decorativos protegibles según PGOU"})`
    );
  }
  if (an?.edificio_reformado) debilidades.push(`el edificio ya aparece reformado, por lo que el margen de valor-añadido se reduce`);
  if (an?.gestion_profesional) debilidades.push(`existe gestión profesional del activo, lo que suele endurecer la negociación`);
  if (debilidades.length) {
    parts.push(`Como puntos a vigilar: ${debilidades.join("; ")}.`);
  }

  // --- Mala gestión ---
  const mg = num(an?.mala_gestion_score) ?? 0;
  if (mg >= 6) {
    parts.push(
      `Se detectan **señales de mala gestión o conflicto entre propietarios** (puntuación ${mg}/10). Es una palanca clave para negociar la entrada y suele justificar un descuento real sobre comparables.`
    );
  }

  return parts;
}

/** Renderiza texto con **negrita** y _cursiva_ simples. */
function RichText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) {
      nodes.push(
        <strong key={i++} className="font-semibold text-foreground">
          {t.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={i++} className="text-muted-foreground">
          {t.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

type Factor = {
  key: string;
  label: string;
  weight: number;
  pts: number;
  raw: any;
};

function factorsFrom(breakdown: any): Factor[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map((c: any) => ({
    key: String(c.key ?? c.label ?? ""),
    label: String(c.label ?? c.key ?? ""),
    weight: Number(c.peso ?? c.weight ?? 0),
    pts: Number(
      c.contribucion ??
        (c.pct != null && Number.isFinite(Number(c.pct))
          ? (Number(c.pct) / 100) * Math.abs(Number(c.peso ?? c.weight ?? 0))
          : 0),
    ),
    raw: c.valor_raw ?? c.raw,
  }));
}

function formatRaw(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : "—";
  return String(v);
}

export function ScoringResumen({
  b,
  s,
  analysis,
  showActivo,
}: {
  b: any;
  s: any;
  analysis: any | null;
  showActivo?: boolean;
}) {
  const cluster: ClusterKey = b?.cluster_asignado ?? "baja_prioridad";
  const clusterInfo = CLUSTER_LABELS[cluster] ?? CLUSTER_LABELS.baja_prioridad;
  // Fuente ÚNICA para el score mostrado — mismo helper que usan la card,
  // el orden del listado y el tier. `showActivo` viene del toggle
  // "Sin propietarios" desde la ficha.
  const mode: "total" | "activo" = showActivo ? "activo" : "total";
  const scoreSource = {
    score_total: s?.score_total ?? b?.score_total,
    score_activo: s?.score_activo ?? b?.score_activo,
    score: s?.score ?? b?.score ?? b?.cluster_score,
  };
  const score = getDisplayScore(scoreSource, mode);
  const tier = scoreTier(score);
  const hasClusterBreakdown = Array.isArray(b?.score_breakdown) && b.score_breakdown.length > 0;
  const breakdown =
    (hasClusterBreakdown
      ? b.score_breakdown
      : Array.isArray(s?.score_breakdown) && s.score_breakdown.length > 0
      ? s.score_breakdown
      : Array.isArray(b?.cluster_breakdown) && b.cluster_breakdown.length > 0
      ? b.cluster_breakdown
      : []) as any[];
  const factors = factorsFrom(breakdown);

  // Nº propietarios: se muestra SIEMPRE como positivo cuando el valor bruto es alto
  // (más propietarios = mejor palanca de proindiviso).
  const isPropietariosFactor = (f: Factor) =>
    /propietari/i.test(f.key) || /propietari/i.test(f.label);
  const rawIsHighPropietarios = (f: Factor) => {
    const n = Number(f.raw);
    return Number.isFinite(n) && n >= 3;
  };

  // Separar positivos (pts>0) y penalizaciones (pts<0 o weight<0)
  const positivos = factors
    .filter((f) => (f.pts > 0 && f.weight > 0) || (isPropietariosFactor(f) && rawIsHighPropietarios(f)))
    .sort((a, b) => b.pts - a.pts);
  const penalizaciones = factors.filter(
    (f) =>
      (f.pts < 0 || f.weight < 0) &&
      !(isPropietariosFactor(f) && rawIsHighPropietarios(f)),
  );

  const clusterSec: string | null = b?.cluster_secundario ?? null;
  const clusterSecInfo = clusterSec ? CLUSTER_LABELS[clusterSec] ?? null : null;

  const avisos: any[] = Array.isArray(b?.avisos_inteligentes) ? b.avisos_inteligentes : [];
  const highAvisos = avisos.filter((a) => a?.severity === "high" || a?.severity === "medium");
  const avisosConDetalle = highAvisos.filter((a) => a?.detail);

  // ─── "Por qué" del score: explicación EXCLUSIVAMENTE a partir de datos reales ───
  // Sin relleno especulativo. Si un dato no existe, no se menciona.
  const ownerBreak = (b?.score_propietarios_breakdown ?? {}) as any;
  const activo = num(s?.score_activo ?? b?.score_activo);
  const propScore = num(s?.score_propietarios ?? b?.score_propietarios);
  const total = num(s?.score_total ?? b?.score_total ?? score);

  const shortWhy = (() => {
    const viv = num(s?.num_viviendas);
    const m2 = num(s?.m2_total);
    const ratio = m2 && viv ? m2 / viv : null;
    const m2Com = num((s as any)?.m2_comercio_x) ?? 0;
    const m2Ofi = num((s as any)?.m2_oficina_x) ?? 0;
    const pctTerc = m2 ? Math.round(((m2Com + m2Ofi) / m2) * 100) : null;

    // Fragmento ACTIVO — solo datos reales
    const activoBits: string[] = [];
    if (m2) activoBits.push(`${m2.toLocaleString()} m²`);
    if (viv) activoBits.push(plural(viv, "vivienda", "viviendas"));
    if (ratio) activoBits.push(`${ratio.toFixed(0)} m²/viv`);
    if (pctTerc !== null) activoBits.push(`${pctTerc}% terciario`);
    const activoTxt = activo != null
      ? `**Activo ${activo.toFixed(0)}**${activoBits.length ? ` (${activoBits.join(", ")})` : ""}`
      : null;

    // Fragmento PROPIETARIOS — solo lo detectado en llamadas/breakdown
    const nO = num(ownerBreak.n_owners);
    const nPos = num(ownerBreak.n_positivos) ?? 0;
    const nBloq = num(ownerBreak.n_bloqueados) ?? 0;
    const nImp = num(ownerBreak.n_impulsor) ?? 0;
    const nCont = num(ownerBreak.n_contactados) ?? 0;
    const oferta = !!ownerBreak.oferta_previa_edificio;
    const mayoria = !!ownerBreak.mayoria_vendedora;
    const impBld = !!ownerBreak.impulsor_edificio;
    const lastCall = ownerBreak.last_call_at ? new Date(ownerBreak.last_call_at) : null;
    const lastCallLabel = lastCall ? `${String(lastCall.getDate()).padStart(2,"0")}/${String(lastCall.getMonth()+1).padStart(2,"0")}` : null;

    const propBits: string[] = [];
    if (nO != null) propBits.push(plural(nO, "propietario", "propietarios"));
    if (mayoria) propBits.push(`mayoría con intención de venta declarada${lastCallLabel ? ` —cita ${lastCallLabel}` : ""}`);
    if (oferta) propBits.push("oferta previa discutida");
    if (impBld || nImp > 0) propBits.push(`${nImp > 1 ? `${nImp} impulsores identificados` : "impulsor identificado"}`);
    if (nPos > 0) propBits.push(`${nPos} con predisposición explícita a vender`);
    if (nBloq > 0) propBits.push(nBloq === 1 ? "1 bloqueador identificado" : `${nBloq} bloqueadores`);
    if (nO != null && nCont >= 0) propBits.push(`${nCont}/${nO} contactados`);

    const propTxt = propScore != null
      ? `**Propietarios ${propScore.toFixed(0)}**${propBits.length ? ` (${propBits.join("; ")})` : ""}`
      : null;

    // Modo ACTIVO puro
    if (showActivo) {
      if (!activoTxt) return [] as string[];
      let s1 = `Estás viendo el score **sin propietarios**: ${activoTxt}.`;
      if (cluster !== "baja_prioridad") {
        s1 += ` Encaja en la tesis **${clusterInfo.label}** (${clusterInfo.tagline.toLowerCase()}).`;
      }
      return [s1];
    }

    // Modo TOTAL: dos párrafos — (1) activo + efecto neto sobre total, (2) situación de propietarios.
    const paras: string[] = [];

    // ── Párrafo 1: activo + dirección del efecto ──
    if (activoTxt && total != null && activo != null) {
      const delta = total - activo;
      const absDelta = Math.abs(delta);
      let direction: string;
      if (absDelta < 0.5) {
        direction = `los propietarios dejan el total prácticamente igual en **${total.toFixed(0)}**`;
      } else if (delta > 0) {
        direction = `los propietarios **SUBEN** el total a **${total.toFixed(0)}** (+${absDelta.toFixed(0)})`;
      } else {
        direction = `los propietarios **FRENAN** el total a **${total.toFixed(0)}** (−${absDelta.toFixed(0)})`;
      }
      let p1 = `El activo vale **${activo.toFixed(0)}**${activoBits.length ? ` (${activoBits.join(", ")})` : ""}; ${direction}. Media ponderada 60% activo · 40% propietarios.`;
      if (cluster !== "baja_prioridad") {
        p1 += ` Tesis: **${clusterInfo.label}** (${clusterInfo.tagline.toLowerCase()}).`;
      }
      paras.push(p1);
    } else if (activoTxt) {
      paras.push(`${activoTxt}.`);
    }

    // ── Párrafo 2: situación de propietarios ──
    const hasAnySignal =
      nPos > 0 || nBloq > 0 || nImp > 0 || oferta || mayoria || impBld || (nCont != null && nCont > 0);
    const owners24hint = nO != null && nO >= 4 ? " — cuantas más puertas, mayor palanca de proindiviso" : "";

    if (!hasAnySignal) {
      // Sin señales todavía
      if (nO != null && nO > 0) {
        paras.push(
          `**Propietarios · sin señales todavía** (0/${nO} contactados): el total refleja solo el activo hasta que las llamadas aporten intención, oferta o bloqueos${owners24hint}.`,
        );
      } else {
        paras.push(
          `**Propietarios · sin datos todavía**: el total refleja solo el activo hasta que se identifiquen propietarios y se hagan llamadas.`,
        );
      }
    } else {
      const bits: string[] = [];
      if (nO != null) bits.push(`**${nO} propietarios**${owners24hint ? "" : ""}`);
      if (mayoria) {
        bits.push(
          `mayoría quiere vender${lastCallLabel ? ` —cita ${lastCallLabel}—` : ""}`,
        );
      } else if (nPos > 0) {
        bits.push(
          `${nPos === 1 ? "1 propietario ha declarado intención de venta" : `${nPos} propietarios han declarado intención de venta`}${lastCallLabel ? ` (última llamada ${lastCallLabel})` : ""}`,
        );
      }
      if (oferta) bits.push(`oferta previa discutida ya sobre la mesa`);
      if (impBld || nImp > 0)
        bits.push(nImp > 1 ? `${nImp} impulsores internos identificados` : `impulsor interno identificado`);
      if (nBloq > 0)
        bits.push(
          nBloq === 1
            ? `1 bloqueador identificado (palanca de negociación, no lastra el score)`
            : `${nBloq} bloqueadores identificados (palanca de negociación, no lastran el score)`,
        );
      if (nO != null) bits.push(`cobertura **${nCont}/${nO}** contactados — trabajo pendiente`);

      let p2 = `**Propietarios ${propScore != null ? propScore.toFixed(0) : "?"}**: ${bits.join("; ")}.`;
      // Cierre interpretativo
      const strong = (mayoria ? 1 : 0) + (oferta ? 1 : 0) + (impBld ? 1 : 0);
      if (strong >= 2) {
        p2 += ` Las señales de intención son dominantes y explican el empujón del eje de propietarios sobre el activo.`;
      } else if (nPos > 0 && !mayoria) {
        p2 += ` Hay tracción parcial: aún no es mayoría, pero ya hay propietarios sueltos abiertos a vender.`;
      } else if (nBloq > 0 && nPos === 0) {
        p2 += ` Sin positivos detectados todavía — priorizar cobertura antes de dar por hecho el bloqueo.`;
      }
      paras.push(p2);
    }

    return paras;
  })();

  // Owner-axis signals para la sección "APORTA AL SCORE"
  const ownerSignals: { label: string; delta: number; evidence?: string }[] = (() => {
    const arr = Array.isArray(ownerBreak.signals) ? ownerBreak.signals : [];
    const labels: Record<string, string> = {
      n_propietarios: "Nº propietarios",
      impulsor_identificado: "Impulsor identificado",
      mayoria_vendedora: "Mayoría vendedora",
      oferta_previa_discutida: "Oferta previa discutida",
      predisposicion_positiva: "Propietario dispuesto a vender",
      bloqueador_identificado: "Bloqueador identificado",
      mayoria_bloqueada: "Mayoría bloqueada",
      todos_cerrados: "Todos los contactados cerrados",
      cobertura_baja: "Cobertura baja (trabajo pendiente)",
    };
    return arr
      .map((sg: any) => ({
        label: labels[sg.signal] ?? sg.signal,
        delta: typeof sg.delta === "number" ? sg.delta : 0,
        evidence: sg.evidence != null ? String(typeof sg.evidence === "object" ? JSON.stringify(sg.evidence) : sg.evidence) : undefined,
      }))
      .filter((x) => Number.isFinite(x.delta) && x.delta !== 0);
  })();
  const ownerPositivos = ownerSignals.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);
  const ownerNegativos = ownerSignals.filter((x) => x.delta < 0);

  return (
    <Card className="overflow-hidden border-border-faint">
      <CardContent className="space-y-6 p-0">
        {/* Cabecera: cluster + score */}
        <div className="flex flex-col gap-4 border-b border-border-faint bg-surface-1/40 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <ScoreGauge score={score} size={120} thickness={10} label={scoreModeLabel(mode)} />
            <div className="space-y-1.5">
              <Eyebrow>
                <Sparkles className="mr-1 inline h-3 w-3" /> Resumen del scoring
              </Eyebrow>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("border font-mono uppercase tracking-eyebrow", clusterInfo.color)}>
                  <MapPin className="mr-1 h-3 w-3" /> {clusterInfo.label}
                </Badge>
                {clusterSecInfo && (
                  <Badge
                    className={cn(
                      "border font-mono uppercase tracking-eyebrow opacity-90",
                      clusterSecInfo.color,
                    )}
                    title="Tesis secundaria"
                  >
                    / {clusterSecInfo.label}
                  </Badge>
                )}
                <span
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-eyebrow",
                    tierTextClass[tier],
                  )}
                >
                  Potencial {tier === "high" ? "alto" : tier === "mid" ? "medio" : "bajo"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {clusterInfo.tagline}
                {clusterSecInfo ? ` · secundaria: ${clusterSecInfo.tagline.toLowerCase()}` : ""}.
              </p>
            </div>
          </div>

          {highAvisos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 md:max-w-sm md:justify-end">
              {highAvisos.map((a, i) => (
                <Badge
                  key={i}
                  variant={a.severity === "high" ? "gold" : "outline"}
                  className="font-mono text-[10px] uppercase tracking-eyebrow"
                >
                  {a.label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Por qué del score: explicación descriptiva extensa — sin IA */}
        {shortWhy.length > 0 && (
          <div className="border-b border-border-faint bg-background/40 px-6 py-4">
            <Eyebrow className="mb-1.5">
              <Sparkles className="mr-1 inline h-3 w-3 text-gold" /> Por qué este score
            </Eyebrow>
            <div className="space-y-2">
              {shortWhy.map((para, i) => (
                <p key={i} className="text-justify text-sm leading-relaxed text-foreground">
                  <RichText text={para} />
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Avisos inteligentes con detalle */}
        {avisosConDetalle.length > 0 && (
          <div className="space-y-2 px-6">
            <Eyebrow>
              <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-400" /> Avisos inteligentes
            </Eyebrow>
            <div className="space-y-2">
              {avisosConDetalle.map((a, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-md border p-3 text-xs",
                    a.severity === "high"
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border-faint bg-surface-1/40",
                  )}
                >
                  <div className="font-semibold text-foreground">{a.label}</div>
                  {a.detail && (
                    <div className="mt-1 text-muted-foreground">{a.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Por qué este score: factores ordenados */}
        <div className="grid grid-cols-1 gap-6 px-6 pb-6 md:grid-cols-2">
          <div className="space-y-3">
            <Eyebrow>
              <TrendingUp className="mr-1 inline h-3 w-3 text-emerald-400" /> Aporta al score
            </Eyebrow>
            <div className="space-y-2.5">
              {positivos.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Sin factores positivos relevantes.
                </div>
              )}
              {positivos.map((f) => {
                const pctOfWeight = f.weight > 0 ? Math.min(100, (f.pts / f.weight) * 100) : 0;
                const t = scoreTier(pctOfWeight);
                return (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-foreground">{f.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatRaw(f.raw)} ·{" "}
                        <span className={tierTextClass[t]}>+{f.pts.toFixed(1)}</span>
                        <span className="ml-0.5 text-[10px] opacity-50">/{f.weight}</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
                      <div
                        className={cn("h-full transition-all duration-500", tierBarClass[t])}
                        style={{ width: `${Math.max(3, pctOfWeight)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Eyebrow>
              <TrendingDown className="mr-1 inline h-3 w-3 text-red-400" /> Penalizaciones
            </Eyebrow>
            <div className="space-y-2.5">
              {penalizaciones.length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin penalizaciones aplicadas.</div>
              ) : (
                penalizaciones.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-red-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-foreground">{f.label}</div>
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-red-400">
                        {f.pts.toFixed(1)} pts
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Propietarios: APORTA AL SCORE (nuevo eje) */}
        {!showActivo && (ownerPositivos.length > 0 || ownerNegativos.length > 0) && (
          <div className="grid grid-cols-1 gap-6 border-t border-border-faint px-6 py-6 md:grid-cols-2">
            <div className="space-y-3">
              <Eyebrow>
                <TrendingUp className="mr-1 inline h-3 w-3 text-emerald-400" /> Propietarios · aporta al score
              </Eyebrow>
              <div className="space-y-2.5">
                {ownerPositivos.length === 0 && (
                  <div className="text-xs text-muted-foreground">Sin señales positivas detectadas todavía.</div>
                )}
                {ownerPositivos.map((f, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-foreground">{f.label}{f.evidence ? <span className="ml-1 text-muted-foreground">· {f.evidence}</span> : null}</span>
                    <span className="font-mono tabular-nums text-emerald-400">+{f.delta}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Eyebrow>
                <TrendingDown className="mr-1 inline h-3 w-3 text-red-400" /> Propietarios · penaliza
              </Eyebrow>
              <div className="space-y-2.5">
                {ownerNegativos.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Sin penalizaciones en el eje de propietarios.</div>
                ) : (
                  ownerNegativos.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-red-400" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-foreground">{f.label}{f.evidence ? <span className="ml-1 text-muted-foreground">· {f.evidence}</span> : null}</div>
                        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-red-400">{f.delta} pts</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {b?.cluster_motivo && (
          <div className="border-t border-border-faint bg-surface-1/40 px-6 py-3">
            <Eyebrow>Motivo del cluster</Eyebrow>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {b.cluster_motivo}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}