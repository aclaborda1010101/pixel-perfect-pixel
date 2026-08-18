/**
 * Investigación previa (T-01) con el proveedor de datos ST Intelligence Lab.
 * Lógica PURA: plan de búsquedas, coste en monedas, clave de caché y
 * normalización mínima de la respuesta. Sin red y sin base de datos.
 *
 * Catálogo real del proveedor (API v1) y coste en monedas por llamada:
 *   dni/search 5 · simple/search 3 · exact/search 3 · combined/search 5
 *   person/{id} 10 · nif/search 10 · phone-directory/particulares 5
 *   phone-directory/particulares/{id} 10 · contact/search 5 · test 0
 */

export type PasoTipo =
  | "dni"
  | "simple"
  | "exact"
  | "combined"
  | "person"
  | "nif"
  | "phone_directory"
  | "phone_directory_detalle"
  | "contact";

export const COSTE_MONEDAS: Record<PasoTipo, number> = {
  dni: 5,
  simple: 3,
  exact: 3,
  combined: 5,
  person: 10,
  nif: 10,
  phone_directory: 5,
  phone_directory_detalle: 10,
  contact: 5,
};

export type SujetoInvestigacion = {
  ownerId: string | null;
  buildingId: string | null;
  nombre: string | null;
  documento?: string | null;
  telefonoActual?: string | null;
  direccionEdificio?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
};

export type PasoPlan = {
  tipo: PasoTipo;
  metodo: "GET" | "POST";
  /** Ruta relativa a la base del proveedor. `:id` se resuelve en ejecución. */
  path: string;
  body?: Record<string, unknown>;
  coste: number;
  /** Sólo se ejecuta si los pasos previos no han dado teléfono. */
  condicional: boolean;
  descripcion: string;
};

/** Normaliza un documento (DNI/NIE/CIF) para comparar y cachear. */
export function normalizarDocumento(doc: string | null | undefined): string | null {
  const s = String(doc ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length >= 8 ? s : null;
}

/** Normaliza un nombre para clave de caché: sin tildes, sin dobles espacios. */
export function normalizarNombre(nombre: string | null | undefined): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parte un nombre completo en nombre y apellidos (heurística española). */
export function partirNombre(nombre: string | null | undefined) {
  const partes = normalizarNombre(nombre).split(" ").filter(Boolean);
  if (partes.length === 0) return { first_name: "", last_name: "", mother_last_name: "" };
  if (partes.length === 1) return { first_name: partes[0], last_name: "", mother_last_name: "" };
  if (partes.length === 2) return { first_name: partes[0], last_name: partes[1], mother_last_name: "" };
  if (partes.length === 3) {
    return { first_name: partes[0], last_name: partes[1], mother_last_name: partes[2] };
  }
  return {
    first_name: partes.slice(0, partes.length - 2).join(" "),
    last_name: partes[partes.length - 2],
    mother_last_name: partes[partes.length - 1],
  };
}

/** Clave estable de caché: la misma búsqueda nunca se repite. */
export function claveCache(tipo: PasoTipo, sujeto: SujetoInvestigacion, extra?: string): string {
  const doc = normalizarDocumento(sujeto.documento);
  const base =
    tipo === "dni" ? `doc:${doc ?? ""}`
    : tipo === "person" ? `person:${extra ?? ""}`
    : tipo === "phone_directory_detalle" ? `tel:${extra ?? ""}`
    : `nom:${normalizarNombre(sujeto.nombre)}|prov:${normalizarNombre(sujeto.provincia ?? sujeto.ciudad)}`;
  return `${tipo}|${base}`;
}

/**
 * Secuencia barata y sensata por propietario:
 *  documento → ficha completa (domicilios) → directorio telefónico si sigue sin teléfono.
 * Sin documento se entra por nombre (+ dirección del edificio si ayuda).
 */
export function planInvestigacion(sujeto: SujetoInvestigacion): PasoPlan[] {
  const pasos: PasoPlan[] = [];
  const doc = normalizarDocumento(sujeto.documento);
  const { first_name, last_name, mother_last_name } = partirNombre(sujeto.nombre);
  const tieneNombre = first_name.length > 0;

  if (doc) {
    pasos.push({
      tipo: "dni",
      metodo: "POST",
      path: "/api/v1/searches/dni/search",
      body: { dni: doc },
      coste: COSTE_MONEDAS.dni,
      condicional: false,
      descripcion: "Buscar a la persona por su documento",
    });
  } else if (tieneNombre && sujeto.direccionEdificio) {
    pasos.push({
      tipo: "combined",
      metodo: "POST",
      path: "/api/v1/searches/combined/search",
      body: {
        first_name,
        last_name,
        mother_last_name,
        address: sujeto.direccionEdificio,
      },
      coste: COSTE_MONEDAS.combined,
      condicional: false,
      descripcion: "Buscar por nombre y dirección del edificio",
    });
  } else if (tieneNombre) {
    pasos.push({
      tipo: "simple",
      metodo: "POST",
      path: "/api/v1/searches/simple/search",
      body: {
        first_name,
        last_name,
        mother_last_name,
        search_type: "exact",
        per_page: 10,
        page: 1,
      },
      coste: COSTE_MONEDAS.simple,
      condicional: false,
      descripcion: "Buscar por nombre y apellidos",
    });
  }

  if (pasos.length > 0) {
    pasos.push({
      tipo: "person",
      metodo: "GET",
      path: "/api/v1/searches/person/:id",
      coste: COSTE_MONEDAS.person,
      condicional: false,
      descripcion: "Ficha completa con domicilio actual y anteriores",
    });
  }

  if (tieneNombre) {
    pasos.push({
      tipo: "phone_directory",
      metodo: "POST",
      path: "/api/v1/searches/phone-directory/particulares",
      body: {
        first_name,
        last_name,
        province: sujeto.provincia ?? sujeto.ciudad ?? "",
        town: sujeto.ciudad ?? "",
      },
      coste: COSTE_MONEDAS.phone_directory,
      condicional: true,
      descripcion: "Directorio telefónico por nombre y provincia (sólo si sigue sin teléfono)",
    });
    pasos.push({
      tipo: "phone_directory_detalle",
      metodo: "GET",
      path: "/api/v1/searches/phone-directory/particulares/:id",
      coste: COSTE_MONEDAS.phone_directory_detalle,
      condicional: true,
      descripcion: "Detalle del directorio con teléfonos (sólo si sigue sin teléfono)",
    });
  }

  return pasos;
}

/** Coste máximo estimado (todos los pasos) y mínimo (sin los condicionales). */
export function costeEstimado(pasos: PasoPlan[]) {
  const maximo = pasos.reduce((a, p) => a + p.coste, 0);
  const minimo = pasos.filter((p) => !p.condicional).reduce((a, p) => a + p.coste, 0);
  return { minimo, maximo };
}

// ---------------------------------------------------------------------------
// Normalización mínima de la respuesta (el contenido completo va al jsonb)
// ---------------------------------------------------------------------------

export type Domicilio = {
  direccion: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  actual: boolean;
};

export type Hallazgos = {
  personIds: string[];
  telefonos: string[];
  domicilios: Domicilio[];
  empresa: Record<string, unknown> | null;
  candidatos: number;
};

function texto(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s.length > 0 ? s : null;
}

function recoger(obj: unknown, claves: string[], out: unknown[], profundidad = 0) {
  if (profundidad > 6 || obj == null) return;
  if (Array.isArray(obj)) {
    for (const it of obj) recoger(it, claves, out, profundidad + 1);
    return;
  }
  if (typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (claves.includes(k.toLowerCase())) out.push(v);
    recoger(v, claves, out, profundidad + 1);
  }
}

/** Teléfono español plausible; descarta ruido y duplicados. */
export function normalizarTelefono(v: unknown): string | null {
  const s = String(v ?? "").replace(/[^\d+]/g, "");
  const nacional = s.replace(/^\+?34/, "");
  return /^[6789]\d{8}$/.test(nacional) ? nacional : null;
}

/**
 * Extrae lo mínimo (identificadores, teléfonos, domicilios, empresa) sin
 * inventar campos: se buscan claves habituales y todo lo demás queda en el jsonb.
 */
export function extraerHallazgos(payload: unknown): Hallazgos {
  const ids: unknown[] = [];
  recoger(payload, ["personid", "person_id", "id"], ids);
  const tel: unknown[] = [];
  recoger(payload, ["phone", "phones", "telefono", "telefonos", "mobile", "movil"], tel);
  const dirs: unknown[] = [];
  recoger(payload, ["address", "addresses", "domicilio", "domicilios", "direccion"], dirs);
  const emp: unknown[] = [];
  recoger(payload, ["company", "empresa", "companies"], emp);

  const telefonos = Array.from(
    new Set(tel.flatMap((t) => (Array.isArray(t) ? t : [t])).map(normalizarTelefono).filter(Boolean)),
  ) as string[];

  const domicilios: Domicilio[] = [];
  for (const d of dirs.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    if (typeof d === "string") {
      const t = texto(d);
      if (t) domicilios.push({ direccion: t, actual: domicilios.length === 0 });
      continue;
    }
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      const dir = texto(o.address ?? o.direccion ?? o.street ?? o.via);
      if (!dir) continue;
      domicilios.push({
        direccion: dir,
        ciudad: texto(o.town ?? o.city ?? o.poblacion ?? o.municipio),
        provincia: texto(o.province ?? o.provincia),
        codigo_postal: texto(o.postal_code ?? o.zip ?? o.codigo_postal ?? o.cp),
        actual: o.current === true || o.actual === true || domicilios.length === 0,
      });
    }
  }

  const personIds = Array.from(
    new Set(ids.map((i) => texto(i)).filter((s): s is string => !!s)),
  ).slice(0, 20);

  const empresaObj = emp.find((e) => e && typeof e === "object" && !Array.isArray(e)) ?? null;

  return {
    personIds,
    telefonos,
    domicilios,
    empresa: (empresaObj as Record<string, unknown> | null) ?? null,
    candidatos: personIds.length,
  };
}

/**
 * Regla del cliente: con homónimos o ambigüedad NO se contacta a nadie.
 * Sin documento, más de un candidato es ambigüedad.
 */
export function evaluarAmbiguedad(
  hallazgos: Hallazgos,
  sujeto: SujetoInvestigacion,
): { ambiguo: boolean; motivo: string | null } {
  const conDocumento = !!normalizarDocumento(sujeto.documento);
  if (!conDocumento && hallazgos.candidatos > 1) {
    return {
      ambiguo: true,
      motivo: `Se han encontrado ${hallazgos.candidatos} personas con ese nombre y no hay documento para distinguirlas. No se contacta a nadie hasta confirmar de quién se trata.`,
    };
  }
  if (!conDocumento && hallazgos.telefonos.length > 2) {
    return {
      ambiguo: true,
      motivo: `Aparecen ${hallazgos.telefonos.length} teléfonos distintos sin documento que confirme la identidad. No se contacta hasta confirmar cuál corresponde al propietario.`,
    };
  }
  return { ambiguo: false, motivo: null };
}

/** Pasos manuales de lo que la API del proveedor no cubre. */
export const PASOS_MANUALES: string[] = [
  "Entra en la web del proveedor con tu propio usuario.",
  "Busca el domicilio del propietario y consulta quién más consta viviendo en esa dirección.",
  "Consulta el padrón del edificio para ver los ocupantes de las demás viviendas.",
  "Anota sólo lo que sirva para localizar al propietario; los inquilinos no se dan de alta como contactos.",
];