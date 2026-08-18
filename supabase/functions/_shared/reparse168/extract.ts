// RE-EXTRACCIÓN REGISTRAL DETERMINISTA (edificios 'a_revisar').
//
// Un hecho por derecho, anclado en cada mención de participación. Cubre las
// DOS morfologías reales del corpus:
//   A) "PARTICIPACION: 6,250000% de la nuda propiedad…" (registros modernos)
//   B) tabla con registros separados por guiones y el derecho en letra
//      ("Una décima parte indivisa en pleno dominio…")
// El rol se clasifica SIEMPRE por el literal del propio hecho: nunca se
// arrastra el rol ni el porcentaje de una inscripción a la siguiente.
// Las menciones dentro de TITULO/TRASLADO son antecedentes, no hechos.
//
// Módulo puro: sin Deno, sin red, sin base de datos.

import { normalizarTexto, valorDerecho } from "./fracciones.ts";

export type RolRegistral = "pleno" | "nuda_propiedad" | "usufructo";

export type HechoRegistral = {
  nombre: string;
  doc: string | null;
  porcentaje: number;
  rol: RolRegistral;
  rol_literal: string;
  cita: string;
  offset: number;
  forma: string;
  gananciales: boolean;
};

export type ExtraccionNota = {
  morfologia: "participacion" | "tabla" | "prosa" | "campos" | "desconocida";
  hechos: HechoRegistral[];
  descartes: Array<{ offset: number; motivo: string; cita: string }>;
};

const RE_PAGINA = /C\.S\.V\.:\s*\S+\s*P[áa]g\.\s*\d+\s*de\s*\d+/g;
const RE_TITULARIDADES = /(?:MAPA\s+DE\s+)?TITULARIDADES?/i;
const RE_CARGAS = /CARGAS(?:\s+Y\s+GRAV[ÁA]MENES)?/i;
const RE_PARTICIPACION = /PARTICIPACI[ÓO]N\s*:/g;
const RE_CIERRE_HECHO = /(TITULO\s*:|T[ÍI]TULO\s*:|TRASLADO\s*:|Formalizada\s|Inscripci[óo]n\s*:|INSCRIPCION\s*:)/;

/** Sustituye los marcadores de página por espacios: conserva los offsets. */
export function limpiarPaginas(src: string): string {
  return src.replace(RE_PAGINA, (m) => " ".repeat(m.length));
}

/** Ventana [TITULARIDADES, CARGAS) sobre el texto original. */
export function ventanaTitularidades(src: string): { inicio: number; fin: number } | null {
  const t = RE_TITULARIDADES.exec(src) ?? /\bTITULARES\b/.exec(src);
  if (!t) return null;
  const inicio = t.index + t[0].length;
  const resto = src.slice(inicio);
  const c = RE_CARGAS.exec(resto);
  return { inicio, fin: c ? inicio + c.index : src.length };
}

const TRATAMIENTOS = /\b(DON|DO[ÑN]A|D\.|DÑA\.?|SR\.?|SRA\.?|HEREDEROS?\s+DE)\b/gi;
const RE_DOC = /\b([A-Z]?\d{1,2}\.\d{3}\.\d{3}\s*[-\/]?\s*[A-Z]?|\d{7,8}\s*[-\/]?\s*[A-Z]|[A-Z]\s*-?\s*\d{7,8}\s*[A-Z]?)\b/g;

/** Nombre + documento del titular a partir del tramo de identidad previo. */
export function identidadDelTramo(tramo: string): { nombre: string; doc: string | null } | null {
  const limpio = tramo.replace(/\s+/g, " ");
  const docs: Array<{ doc: string; index: number; fin: number }> = [];
  RE_DOC.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_DOC.exec(limpio))) docs.push({ doc: m[1].replace(/\s+/g, ""), index: m.index, fin: m.index + m[0].length });
  // El documento del titular es el ÚLTIMO anterior al hecho; "NC" = sin documento.
  const ncIdx = limpio.lastIndexOf(" NC ");
  const ultimo = docs.length ? docs[docs.length - 1] : null;
  const corte = ultimo && ultimo.index > ncIdx ? ultimo.index : ncIdx >= 0 ? ncIdx : limpio.length;
  const doc = ultimo && ultimo.index > ncIdx ? ultimo.doc.replace(/[-/]$/, "") : null;
  const nombre = nombreAlFinal(limpio.slice(0, corte));
  if (!nombre) return null;
  return { nombre, doc };
}

const RUIDO = /\b(TOMO|LIBRO|FOLIO|ALTA|FINCA|SECCION|SECCI[ÓO]N|INSCRIPCION|INSCRIPCI[ÓO]N|FECHA|NOMBRE|TITULAR|N\.?I\.?F\.?|C\.?I\.?F\.?|D\.?N\.?I\.?|PROTOCOLO|NOTARIO|ESCRITURA|P[ÚU]BLICA|HERENCIA|COMPRAVENTA|VIRTUD|ADQUIRIDA|POR|EL|EN|CON)\b/;

const PARTICULAS = /^(DE|DEL|LA|LAS|LOS|Y|VDA|VIUDA)\.?,?$/;

function nombreAlFinal(zona: string): string | null {
  const bruto = zona
    .replace(TRATAMIENTOS, " ")
    .replace(/[_\-]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = bruto.split(" ").filter(Boolean);
  const partes: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && partes.length < 10; i--) {
    const t = tokens[i].replace(/^[^A-ZÁÉÍÓÚÜÑ0-9]+/, "").replace(/[.;:]+$/, "");
    if (!t) continue;
    if (/^[\d.,/º-]+$/.test(t)) {
      if (partes.length) break;
      continue;
    }
    if (!/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'’.\-]*,?$/.test(t)) break;
    // Partículas de nombres compuestos ("MARIA DE LA FE"): continúan el nombre
    // pero nunca lo encabezan.
    if (PARTICULAS.test(t) && !partes.length) break;
    if (RUIDO.test(t.replace(/,$/, "").toUpperCase())) break;
    partes.unshift(t);
  }
  while (partes.length && PARTICULAS.test(partes[0])) partes.shift();
  const nombre = partes.join(" ").replace(/^[,\s]+|[,\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (nombre.replace(/[^A-ZÁÉÍÓÚÜÑ]/gi, "").length < 4) return null;
  return nombre;
}

/** Rol por el literal del propio hecho (primera mención jurídica del tramo). */
export function rolDelHecho(tramo: string): { rol: RolRegistral; literal: string } | null {
  const p = normalizarTexto(tramo);
  const candidatos: Array<{ rol: RolRegistral; idx: number; literal: string }> = [];
  const nuda = p.indexOf("nuda propiedad");
  const usu = p.search(/usufructo|usufructuari/);
  const pleno = p.search(/pleno dominio|plena propiedad|dominio pleno/);
  if (nuda >= 0) candidatos.push({ rol: "nuda_propiedad", idx: nuda, literal: "nuda propiedad" });
  if (usu >= 0) candidatos.push({ rol: "usufructo", idx: usu, literal: "usufructo" });
  if (pleno >= 0) candidatos.push({ rol: "pleno", idx: pleno, literal: "pleno dominio" });
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => a.idx - b.idx);
  return { rol: candidatos[0].rol, literal: candidatos[0].literal };
}

function corteHecho(tramo: string): string {
  const m = RE_CIERRE_HECHO.exec(tramo);
  return m && m.index > 0 ? tramo.slice(0, m.index) : tramo;
}

function construirHecho(identidadTramo: string, hechoTramo: string, offset: number): { hecho?: HechoRegistral; motivo?: string } {
  const cita = hechoTramo.replace(/\s+/g, " ").trim().slice(0, 400);
  const rol = rolDelHecho(hechoTramo);
  if (!rol) return { motivo: "rol_no_declarado" };
  const valor = valorDerecho(hechoTramo);
  if (!valor) return { motivo: "porcentaje_no_localizado" };
  const id = identidadDelTramo(identidadTramo);
  if (!id) return { motivo: "titular_no_localizado" };
  const gananciales = /gananciales/.test(normalizarTexto(hechoTramo));
  return {
    hecho: {
      nombre: id.nombre,
      doc: id.doc,
      porcentaje: valor.porcentaje,
      rol: rol.rol,
      rol_literal: gananciales ? `${rol.literal} (sociedad de gananciales)` : rol.literal,
      cita,
      offset,
      forma: valor.forma,
      gananciales,
    },
  };
}

/** Morfología A: un hecho por token "PARTICIPACION:". */
function extraerPorParticipacion(seccion: string, base: number): ExtraccionNota {
  const hechos: HechoRegistral[] = [];
  const descartes: ExtraccionNota["descartes"] = [];
  const tokens: number[] = [];
  RE_PARTICIPACION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_PARTICIPACION.exec(seccion))) tokens.push(m.index);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Identidad: todo el texto entre el hecho anterior y este token; el titular
    // es SIEMPRE el último nombre antes de la participación.
    const idInicio = i > 0 ? tokens[i - 1] + "PARTICIPACION:".length : 0;
    const sigue = i + 1 < tokens.length ? tokens[i + 1] : seccion.length;
    const bruto = seccion.slice(t, sigue);
    const hechoTramo = corteHecho(bruto);
    const r = construirHecho(seccion.slice(idInicio, t), hechoTramo, base + t);
    if (r.hecho) hechos.push(r.hecho);
    else descartes.push({ offset: base + t, motivo: r.motivo!, cita: hechoTramo.replace(/\s+/g, " ").slice(0, 200) });
  }
  return { morfologia: "participacion", hechos, descartes };
}

/** Morfología B: tabla con registros separados por tiras de guiones. */
// Ancla de fila: valor (porcentaje o fracción) seguido del literal del derecho.
const RE_ANCLA_TABLA = /(?:\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*%|\b\d{1,4}\s*\/\s*\d{1,4}\b)[^%]{0,120}?(?:pleno\s+dominio|nuda\s+propiedad|usufructo)/gi;

function extraerPorTabla(seccion: string, base: number): ExtraccionNota {
  const hechos: HechoRegistral[] = [];
  const descartes: ExtraccionNota["descartes"] = [];
  const re = /-{6,}/g;
  const cortes: Array<[number, number]> = [];
  let prev = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seccion))) {
    if (m.index > prev) cortes.push([prev, m.index]);
    prev = m.index + m[0].length;
  }
  if (prev < seccion.length) cortes.push([prev, seccion.length]);
  for (const [a, b] of cortes) {
    const registro = seccion.slice(a, b);
    if (!/[A-ZÁÉÍÓÚÜÑ]{3}/.test(registro)) continue;
    // Cuando el PDF llega sin saltos de línea, todas las filas de la tabla
    // caen en un único registro: se segmenta por cada mención de derecho.
    const anclas: number[] = [];
    RE_ANCLA_TABLA.lastIndex = 0;
    let ma: RegExpExecArray | null;
    while ((ma = RE_ANCLA_TABLA.exec(registro))) anclas.push(ma.index);
    if (anclas.length > 1) {
      for (let i = 0; i < anclas.length; i++) {
        const ini = anclas[i];
        const fin = i + 1 < anclas.length ? anclas[i + 1] : registro.length;
        const hechoTramo = corteHecho(registro.slice(ini, fin));
        const idTramo = registro.slice(i > 0 ? anclas[i - 1] : 0, ini);
        const r = construirHecho(idTramo, hechoTramo, base + a + ini);
        if (r.hecho) hechos.push(r.hecho);
        else descartes.push({ offset: base + a + ini, motivo: r.motivo!, cita: hechoTramo.replace(/\s+/g, " ").slice(0, 200) });
      }
      continue;
    }
    // Cabecera: nombre + documento + tomo/libro/folio/alta; el derecho va después.
    const mm = /(?:\d{1,5}\s+){2,4}(?=[A-Za-zÁÉÍÓÚÜÑ])/.exec(registro);
    const sep = mm ? mm.index + mm[0].length : 0;
    const hechoTramo = corteHecho(registro.slice(sep));
    if (!hechoTramo.trim()) continue;
    const rol = rolDelHecho(hechoTramo);
    const valor = valorDerecho(hechoTramo);
    if (!rol && !valor) continue; // fila de cabecera o texto sin derecho
    const r = construirHecho(registro.slice(0, sep || registro.length), hechoTramo, base + a);
    if (r.hecho) hechos.push(r.hecho);
    else descartes.push({ offset: base + a, motivo: r.motivo!, cita: hechoTramo.replace(/\s+/g, " ").slice(0, 200) });
  }
  return { morfologia: "tabla", hechos, descartes };
}

const RE_ANCLA_PROSA = /(?:\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)\s*%|\b\d{1,4}\s*\/\s*\d{1,4}\b|(?:pleno\s+dominio|nuda\s+propiedad|usufructo)\s+de\s+(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|la|las)\s+(?:[a-zá-úé]+\s+){0,2}?(?:part|mitad|terc|cuart|quint|sext|s[eé]ptim|octav|noven|d[eé]cim|onceav|doceav|catorceav|quinceav|veinteav|treintav)/gi;
const RE_CIERRE_PROSA = /(Formalizada|seg[úu]n\s+resulta|por\s+t[íi]tulo|inscrita|Inscripci[óo]n)/;
const RE_LABEL_DOC = /\b(N\.?\s?I\.?\s?F\.?|D\.?\s?N\.?\s?I\.?|C\.?\s?I\.?\s?F\.?|NIE)\b\s*:?/gi;

/** Nombre en morfología de prosa: última tira de mayúsculas del tramo previo. */
export function nombreProsa(tramo: string): { nombre: string; doc: string | null } | null {
  const t = String(tramo).replace(/\s+/g, " ");
  RE_DOC.lastIndex = 0;
  const docs = t.match(RE_DOC) ?? [];
  const doc = docs.length ? docs[docs.length - 1].replace(/\s+/g, "") : null;
  const limpio = t
    .replace(RE_LABEL_DOC, " ")
    .replace(RE_DOC, " ")
    .replace(TRATAMIENTOS, " ")
    .replace(/\s+/g, " ");
  const runs: Array<{ txt: string; i: number; fin: number }> = [];
  const reRun = /(?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'’\-]+)(?:\s+(?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'’\-]+|DE|DEL|LA|LAS|LOS))*/g;
  let m: RegExpExecArray | null;
  while ((m = reRun.exec(limpio))) {
    const partes = m[0].split(" ").filter((x) => x && !RUIDO.test(x));
    while (partes.length && PARTICULAS.test(partes[0])) partes.shift();
    while (partes.length && PARTICULAS.test(partes[partes.length - 1])) partes.pop();
    if (partes.length < 2) continue;
    runs.push({ txt: partes.join(" "), i: m.index, fin: m.index + m[0].length });
  }
  if (!runs.length) return null;
  const ult = runs[runs.length - 1];
  const prev = runs.length > 1 ? runs[runs.length - 2] : null;
  // Matrimonio: dos nombres unidos por " y " (gananciales) -> un solo hecho.
  const nombre = prev && /^\s*y\s*$/i.test(limpio.slice(prev.fin, ult.i))
    ? `${prev.txt} y ${ult.txt}`
    : ult.txt;
  if (nombre.replace(/[^A-ZÁÉÍÓÚÜÑ]/gi, "").length < 4) return null;
  return { nombre, doc };
}

/** Morfología C: prosa bajo el epígrafe TITULARES, un hecho por participación. */
function extraerPorProsa(seccion: string, base: number): ExtraccionNota {
  const hechos: HechoRegistral[] = [];
  const descartes: ExtraccionNota["descartes"] = [];
  const anclas: number[] = [];
  RE_ANCLA_PROSA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ANCLA_PROSA.exec(seccion))) anclas.push(m.index);
  for (let i = 0; i < anclas.length; i++) {
    const a = anclas[i];
    const sig = i + 1 < anclas.length ? anclas[i + 1] : seccion.length;
    const bruto = seccion.slice(a, Math.min(sig, a + 400));
    const cierre = RE_CIERRE_PROSA.exec(bruto);
    const hechoTramo = cierre && cierre.index > 0 ? bruto.slice(0, cierre.index) : bruto;
    const prevIdx = i > 0 ? anclas[i - 1] : 0;
    // El literal del derecho puede preceder a la cifra ("del pleno dominio del
    // 100,00%"): se mira hacia atrás sólo hasta la mención anterior.
    const atras = seccion.slice(Math.max(prevIdx, a - 90), a);
    const rol = rolDelHecho(hechoTramo) ?? rolDelHecho(atras);
    const valor = valorDerecho(hechoTramo);
    if (!rol || !valor) continue; // porcentaje de un antecedente, no un derecho
    const id = nombreProsa(seccion.slice(i > 0 ? anclas[i - 1] : 0, a));
    const cita = hechoTramo.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!id) { descartes.push({ offset: base + a, motivo: "titular_no_localizado", cita: cita.slice(0, 200) }); continue; }
    const gananciales = /ganancial|c[óo]nyuges|esposos/.test(normalizarTexto(hechoTramo + " " + atras));
    hechos.push({
      nombre: id.nombre,
      doc: id.doc,
      porcentaje: valor.porcentaje,
      rol: rol.rol,
      rol_literal: gananciales ? `${rol.literal} (sociedad de gananciales)` : rol.literal,
      cita,
      offset: base + a,
      forma: valor.forma,
      gananciales,
    });
  }
  return { morfologia: "prosa", hechos, descartes };
}

const RE_CAMPO_NOMBRE = /Nombre\.{2,}\s*:/g;

/** Morfología D: fichas de campos con puntos ("Nombre....: X"). */
function extraerPorCampos(seccion: string, base: number): ExtraccionNota {
  const hechos: HechoRegistral[] = [];
  const descartes: ExtraccionNota["descartes"] = [];
  RE_CAMPO_NOMBRE.lastIndex = 0;
  const inicios: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_CAMPO_NOMBRE.exec(seccion))) inicios.push(m.index);
  for (let i = 0; i < inicios.length; i++) {
    const a = inicios[i];
    const bloque = seccion.slice(a, i + 1 < inicios.length ? inicios[i + 1] : seccion.length);
    const campo = (etq: string) => {
      const r = new RegExp(etq + "[.\\s]*:\\s*([^\\n]*?)(?=\\s{2,}|[A-Za-zÁÉÍÓÚÜÑ ]{3,30}\\.{2,}\\s*:|$)", "i").exec(bloque);
      return r ? r[1].trim() : "";
    };
    const nombreBruto = campo("Nombre");
    const rol = rolDelHecho(campo("Naturaleza\\s+del\\s+Derecho") || bloque);
    const valor = valorDerecho(campo("Participaci[óo]n"));
    const cita = bloque.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!rol || !valor) { descartes.push({ offset: base + a, motivo: !rol ? "rol_no_declarado" : "participacion_no_localizada", cita: cita.slice(0, 200) }); continue; }
    const id = nombreProsa(nombreBruto + " " + campo("N\\.?I\\.?F\\.?"));
    if (!id) { descartes.push({ offset: base + a, motivo: "titular_no_localizado", cita: cita.slice(0, 200) }); continue; }
    const gananciales = /ganancial/.test(normalizarTexto(bloque));
    hechos.push({
      nombre: id.nombre, doc: id.doc, porcentaje: valor.porcentaje, rol: rol.rol,
      rol_literal: gananciales ? `${rol.literal} (sociedad de gananciales)` : rol.literal,
      cita, offset: base + a, forma: valor.forma, gananciales,
    });
  }
  return { morfologia: "campos", hechos, descartes };
}

/** Extracción completa de una nota desde su texto bruto. */
export function extraerHechosNota(raw: string): ExtraccionNota {
  const src = limpiarPaginas(String(raw ?? ""));
  const v = ventanaTitularidades(src);
  if (!v) return { morfologia: "desconocida", hechos: [], descartes: [{ offset: 0, motivo: "sin_seccion_titularidades", cita: "" }] };
  const seccion = src.slice(v.inicio, v.fin);
  RE_PARTICIPACION.lastIndex = 0;
  const conParticipacion = (seccion.match(RE_PARTICIPACION) ?? []).length;
  if (conParticipacion > 0) return extraerPorParticipacion(seccion, v.inicio);
  if (/Nombre\.{2,}\s*:/.test(seccion)) return extraerPorCampos(seccion, v.inicio);
  if (/-{6,}/.test(seccion)) return extraerPorTabla(seccion, v.inicio);
  return extraerPorProsa(seccion, v.inicio);
}

export type Capas = { pleno: number; nuda_propiedad: number; usufructo: number };

export function sumarCapas(hechos: HechoRegistral[]): Capas {
  const c: Capas = { pleno: 0, nuda_propiedad: 0, usufructo: 0 };
  for (const h of hechos) c[h.rol] += h.porcentaje;
  return { pleno: r2(c.pleno), nuda_propiedad: r2(c.nuda_propiedad), usufructo: r2(c.usufructo) };
}

function r2(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export const TOLERANCIA = 0.75;

export type Puerta = { ok: true; capas: Capas } | { ok: false; capas: Capas; motivo: string };

/**
 * VALIDADOR-PUERTA. La nota sólo puede reemplazar titulares si cierra:
 * pleno + nuda = 100 ±0,75 y nuda = usufructo ±0,75, sin hechos sin porcentaje.
 */
export function validarPuerta(ex: ExtraccionNota): Puerta {
  const capas = sumarCapas(ex.hechos);
  if (!ex.hechos.length) return { ok: false, capas, motivo: "la nota no arroja ningún titular con derecho" };
  const sinPct = ex.hechos.filter((h) => !(h.porcentaje > 0));
  if (sinPct.length) return { ok: false, capas, motivo: `${sinPct.length} titulares sin porcentaje` };
  if (ex.descartes.length) {
    const motivos = [...new Set(ex.descartes.map((d) => d.motivo))].join(", ");
    return { ok: false, capas, motivo: `${ex.descartes.length} menciones no interpretables (${motivos})` };
  }
  const total = r2(capas.pleno + capas.nuda_propiedad);
  if (Math.abs(total - 100) > TOLERANCIA) {
    const falta = r2(100 - total);
    return {
      ok: false,
      capas,
      motivo: falta > 0
        ? `la propia nota no cierra: falta ${falta}% entre pleno dominio y nuda propiedad`
        : `la propia nota no cierra: sobra ${r2(-falta)}% entre pleno dominio y nuda propiedad`,
    };
  }
  if (Math.abs(capas.nuda_propiedad - capas.usufructo) > TOLERANCIA) {
    return {
      ok: false,
      capas,
      motivo: `la propia nota no cierra: nuda propiedad ${capas.nuda_propiedad}% frente a usufructo ${capas.usufructo}%`,
    };
  }
  return { ok: true, capas };
}
