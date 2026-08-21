// Datos del inmueble: HubSpot manda. Los mantiene el cliente en su CRM, así que
// aquí sólo se leen y se sobrescriben en nuestra base. Nunca se escribe en HubSpot.

/** Propiedades del negocio que definen el inmueble. */
export const INMUEBLE_DEAL_PROPERTIES = [
  'dealname',
  'address',
  'dealstage',
  'referencia_catastral',
  'uso_principal',
  'metros_cuadrados_viviendas',
  'metros_cuadrados_viviendas___clonada_',
  'viviendas__unidades___clonada_',
  'viviendas__unidades_',
  'porcentaje_terciario',
  'porcentaje_residencial',
];

export interface DatosInmueble {
  direccion: string | null;
  refcatastral: string | null;
  uso_principal: string | null;
  metros_viviendas: number | null;
  num_viviendas: number | null;
  pct_terciario: number | null;
  pct_residencial: number | null;
  dealstage: string | null;
}

function texto(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

function numero(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  // "2.594,50" o "2594.5" o "0.207" → número
  let limpio = s.replace(/[%\s]/g, '');
  // El punto sólo es separador de miles si hay coma decimal o grupos exactos de tres.
  if (limpio.includes(',') || /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(limpio)) {
    limpio = limpio.replace(/\./g, '');
  }
  limpio = limpio.replace(',', '.');
  const n = Number(limpio.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function entero(v: unknown): number | null {
  const n = numero(v);
  return n === null ? null : Math.round(n);
}

/**
 * Porcentaje en un único formato: tanto por ciento con dos decimales.
 * Acepta "84.37%", "84,37", 0.8437 (fracción) y devuelve siempre 84.37.
 */
export function normalizarPorcentaje(v: unknown): number | null {
  const n = numero(v);
  if (n === null) return null;
  if (n < 0) return null;
  // Una fracción (0 < n <= 1) es el mismo dato dividido por cien.
  const escalado = n > 0 && n <= 1 ? n * 100 : n;
  if (escalado > 100) return 100;
  return Math.round(escalado * 100) / 100;
}

/** Lee del negocio de HubSpot los campos del inmueble, ya normalizados. */
export function datosInmuebleDesdeHubspot(props: Record<string, unknown>): DatosInmueble {
  return {
    direccion: texto(props.dealname) ?? texto(props.address),
    refcatastral: texto(props.referencia_catastral)?.toUpperCase() ?? null,
    uso_principal: texto(props.uso_principal),
    metros_viviendas:
      numero(props.metros_cuadrados_viviendas) ??
      numero(props['metros_cuadrados_viviendas___clonada_']),
    num_viviendas:
      entero(props['viviendas__unidades___clonada_']) ?? entero(props['viviendas__unidades_']),
    pct_terciario: normalizarPorcentaje(props.porcentaje_terciario),
    pct_residencial: normalizarPorcentaje(props.porcentaje_residencial),
    dealstage: texto(props.dealstage),
  };
}

export interface CambioInmueble {
  campo: string;
  antes: string | number | null;
  despues: string | number | null;
}

const TOLERANCIA: Record<string, number> = {
  metros_viviendas: 1,
  pct_terciario: 0.5,
  pct_residencial: 0.5,
};

/** Qué campos cambian al aplicar lo de HubSpot sobre lo nuestro. */
export function cambiosInmueble(
  nuestro: Record<string, unknown>,
  hs: DatosInmueble,
): { parche: Record<string, unknown>; cambios: CambioInmueble[] } {
  const parche: Record<string, unknown> = {};
  const cambios: CambioInmueble[] = [];

  for (const [campo, valor] of Object.entries(hs) as Array<[keyof DatosInmueble, unknown]>) {
    if (campo === 'dealstage') continue; // no vive en buildings
    if (valor === null || valor === undefined) continue; // HubSpot no lo tiene: no se borra nada
    const mio = (nuestro as Record<string, unknown>)[campo];

    let iguales: boolean;
    if (typeof valor === 'number') {
      const n = mio === null || mio === undefined || mio === '' ? null : Number(mio);
      const tol = TOLERANCIA[campo as string] ?? 0;
      iguales = n !== null && Number.isFinite(n) && Math.abs(n - valor) <= tol;
    } else {
      const s = texto(mio);
      iguales =
        s !== null &&
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() ===
          String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    if (iguales) continue;
    parche[campo as string] = valor;
    cambios.push({
      campo: campo as string,
      antes: (mio ?? null) as string | number | null,
      despues: valor as string | number,
    });
  }

  return { parche, cambios };
}

/** Lee el negocio, sobrescribe los campos del inmueble y guarda lo que dice HubSpot. */
export async function aplicarDatosInmueble(
  admin: any,
  building: Record<string, unknown>,
  props: Record<string, unknown>,
): Promise<CambioInmueble[]> {
  const hs = datosInmuebleDesdeHubspot(props);
  const { parche, cambios } = cambiosInmueble(building, hs);

  if (Object.keys(parche).length > 0) {
    const { error } = await admin.from('buildings').update(parche).eq('id', building.id);
    if (error) throw new Error(`guardando datos del inmueble: ${error.message}`);
  }

  await admin.from('hs_inmueble_snapshot').upsert({
    building_id: building.id,
    hs_deal_id: building.hs_deal_id ?? null,
    direccion: hs.direccion,
    refcatastral: hs.refcatastral,
    metros_viviendas: hs.metros_viviendas,
    num_viviendas: hs.num_viviendas,
    pct_terciario: hs.pct_terciario,
    pct_residencial: hs.pct_residencial,
    uso_principal: hs.uso_principal,
    dealstage: hs.dealstage,
    leido_at: new Date().toISOString(),
  }, { onConflict: 'building_id' });

  return cambios;
}
