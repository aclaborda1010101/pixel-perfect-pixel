// Cotejo campo a campo de UN edificio contra HubSpot.
// SOLO LECTURA sobre HubSpot. Escribe únicamente en nuestra base.
//
// Reglas de negocio que se aplican ANTES de juzgar una diferencia:
//  - el usufructo no suma propiedad
//  - los gananciales no se duplican
//  - las empresas con cuota SÍ son propietarias
//  - un titular con cuota en varias fincas del mismo edificio suma sus cuotas
//  - cada finca tiene su propio 100 %
//  - "Es Familiar" / "No Corresponde" => influenciador, no propietario
//
// Estas reglas viven en la vista v_owner_score y en recalcular_influenciadores;
// aquí sólo se comparan los campos del inmueble y se registran incidencias.

export type Resolucion = 'auto_corregido' | 'revision_humana' | 'sin_datos';

export interface Incidencia {
  building_id: string | null;
  tipo: string;
  titulo: string;
  detalle: Record<string, unknown>;
  resolucion: Resolucion;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function ent(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function txt(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

/** Dos textos son "el mismo dato" salvo mayúsculas, tildes y puntuación. */
export function mismoTexto(a: unknown, b: unknown): boolean {
  const n = (v: unknown) =>
    String(v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b);
}

/** Diferencia relativa tolerable en metros/unidades (redondeos de HubSpot). */
export function casiIgual(a: number, b: number, tol = 0.02): boolean {
  if (a === b) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= tol;
}

export interface CampoCotejo {
  /** Columna nuestra. */
  col: string;
  /** Etiqueta legible. */
  etiqueta: string;
  /** Valor que dice HubSpot (ya normalizado). */
  hs: string | number | null;
  /** Valor que decimos nosotros. */
  nuestro: string | number | null;
  /** true si los valores son equivalentes según las reglas del campo. */
  iguales: boolean;
}

/** Extrae del negocio de HubSpot los campos del inmueble que nos interesan. */
export function camposDelNegocio(props: Record<string, unknown>) {
  const mViv = num(props.metros_cuadrados_viviendas) ?? num(props['metros_cuadrados_viviendas___clonada_']);
  const mCom = num(props.metros_cuadrados_comercio);
  const mOfi = num(props.metros_cuadrados_oficina) ?? num(props.metros_cuadrado_oficina);
  const mTotalDeclarado = num(props['metros_cuadrados__exactos_']) ?? num(props['metros_cuadrados__exactos____clonada_']);
  const viviendas = ent(props['viviendas__unidades_']) ?? ent(props['viviendas__unidades___clonada_']);

  // Terciario = comercio + oficina sobre el total. Sólo se calcula si hay base real.
  const base = mTotalDeclarado ?? [mViv, mCom, mOfi].reduce<number>((t, v) => t + (v ?? 0), 0);
  const terciario = base && base > 0 && (mCom !== null || mOfi !== null)
    ? Math.round((((mCom ?? 0) + (mOfi ?? 0)) / base) * 10000) / 100
    : null;
  const residencial = base && base > 0 && mViv !== null
    ? Math.round(((mViv / base) * 10000)) / 100
    : null;

  return {
    direccion: txt(props.dealname) ?? txt(props.address),
    refcatastral: txt(props.referencia_catastral),
    metros_viviendas: mViv,
    metros_comercio: mCom,
    metros_oficina: mOfi,
    num_viviendas: viviendas,
    pct_terciario: terciario,
    pct_residencial: residencial,
    distrito: txt(props['distrito_zona__clonada_']) ?? txt(props.distrito_zona),
    barrio: txt(props['barrios_completos__clonada_']) ?? txt(props.barrios_completos),
    dealstage: txt(props.dealstage),
  };
}

/**
 * Compara campo a campo el inmueble.
 * Devuelve:
 *  - `parche`: lo que se puede rellenar sin ambigüedad (ellos lo tienen, nosotros no).
 *  - `incidencias`: contradicciones (ambos tienen dato y no coinciden) o ausencia total.
 */
export function cotejarInmueble(
  buildingId: string,
  nuestro: Record<string, unknown>,
  hs: ReturnType<typeof camposDelNegocio>,
): { parche: Record<string, unknown>; incidencias: Incidencia[]; comparados: CampoCotejo[] } {
  const parche: Record<string, unknown> = {};
  const incidencias: Incidencia[] = [];
  const comparados: CampoCotejo[] = [];

  const campos: Array<{
    col: string;
    etiqueta: string;
    hs: string | number | null;
    tipo: 'texto' | 'numero';
    tol?: number;
  }> = [
    { col: 'direccion', etiqueta: 'dirección', hs: hs.direccion, tipo: 'texto' },
    { col: 'refcatastral', etiqueta: 'referencia catastral', hs: hs.refcatastral, tipo: 'texto' },
    { col: 'metros_viviendas', etiqueta: 'metros construidos de vivienda', hs: hs.metros_viviendas, tipo: 'numero' },
    { col: 'metros_comercio', etiqueta: 'metros de comercio', hs: hs.metros_comercio, tipo: 'numero' },
    { col: 'metros_oficina', etiqueta: 'metros de oficina', hs: hs.metros_oficina, tipo: 'numero' },
    { col: 'num_viviendas', etiqueta: 'número de viviendas', hs: hs.num_viviendas, tipo: 'numero' },
    { col: 'pct_terciario', etiqueta: 'porcentaje terciario', hs: hs.pct_terciario, tipo: 'numero', tol: 0.05 },
    { col: 'pct_residencial', etiqueta: 'porcentaje residencial', hs: hs.pct_residencial, tipo: 'numero', tol: 0.05 },
    { col: 'distrito', etiqueta: 'distrito', hs: hs.distrito, tipo: 'texto' },
    { col: 'barrio', etiqueta: 'barrio', hs: hs.barrio, tipo: 'texto' },
  ];

  for (const c of campos) {
    const mio = c.tipo === 'numero' ? num(nuestro[c.col]) : txt(nuestro[c.col]);
    const suyo = c.hs;
    const iguales = suyo === null && mio === null
      ? true
      : suyo === null || mio === null
        ? false
        : c.tipo === 'numero'
          ? casiIgual(Number(mio), Number(suyo), c.tol ?? 0.02)
          : mismoTexto(mio, suyo);

    comparados.push({ col: c.col, etiqueta: c.etiqueta, hs: suyo, nuestro: mio, iguales });

    if (iguales) continue;

    if (suyo !== null && mio === null) {
      // Inequívoco: ellos lo tienen y nosotros no. Se corrige solo.
      parche[c.col] = suyo;
      incidencias.push({
        building_id: buildingId,
        tipo: 'campo_faltaba',
        titulo: `Se ha traído de HubSpot ${c.etiqueta}`,
        detalle: { campo: c.col, hubspot: suyo, nuestro: null },
        resolucion: 'auto_corregido',
      });
      continue;
    }
    if (suyo === null && mio !== null) {
      // Nosotros lo tenemos y ellos no: no se toca nada, sólo se deja constancia.
      incidencias.push({
        building_id: buildingId,
        tipo: 'campo_solo_nuestro',
        titulo: `${c.etiqueta}: sólo consta en nuestra base`,
        detalle: { campo: c.col, hubspot: null, nuestro: mio },
        resolucion: 'revision_humana',
      });
      continue;
    }
    // Ambos tienen dato y no coinciden: manda HubSpot en datos del inmueble,
    // pero se registra la diferencia para que quede visible en la ficha.
    parche[c.col] = suyo;
    incidencias.push({
      building_id: buildingId,
      tipo: 'campo_discrepante',
      titulo: `${c.etiqueta}: HubSpot y nuestra base no coincidían`,
      detalle: { campo: c.col, hubspot: suyo, nuestro: mio, aplicado: 'hubspot' },
      resolucion: 'auto_corregido',
    });
  }

  const sinNada = comparados.every((c) => c.hs === null && c.nuestro === null);
  if (sinNada) {
    incidencias.push({
      building_id: buildingId,
      tipo: 'sin_datos_en_ninguna_fuente',
      titulo: 'No hay datos del inmueble ni en HubSpot ni en nuestra base',
      detalle: {},
      resolucion: 'sin_datos',
    });
  }

  return { parche, incidencias, comparados };
}
