/**
 * Guarda de arquitectura: inventario REAL de operaciones de escritura de
 * creación (`insert`/`upsert`) sobre `building_tasks`.
 *
 * No hay allowlist por archivo: cada operación encontrada se empareja con su
 * payload y se clasifica. Solo dos operaciones están autorizadas, y cada una
 * debe estar dentro de su helper dedicado y escribir la fila validada.
 * Los `update`/`delete` de ciclo de vida NO son creación y no cuentan.
 */

export type WriteOp = {
  file: string;
  kind: "ts" | "sql";
  op: "insert" | "upsert";
  /** Texto del payload emparejado con la operación (objeto TS o cuerpo SQL). */
  payload: string;
  line: number;
};

export type Violation = { file: string; line: number; reason: string };

/** Los dos únicos escritores autorizados y el contrato que deben cumplir. */
export const AUTHORIZED_WRITERS: Record<
  string,
  { id: "v5_call_queue" | "manual"; payload: RegExp; requires: RegExp }
> = {
  "supabase/functions/_shared/taskWriters.ts": {
    id: "v5_call_queue",
    payload: /^row$/,
    requires: /assertV5CallQueueRow\(row\)/,
  },
  "src/lib/taskWriters.ts": {
    id: "manual",
    payload: /^row$/,
    requires: /const row = buildManualTaskRow\(input\)/,
  },
};

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/** Captura el argumento equilibrado que sigue a un paréntesis de apertura. */
function balancedArg(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i).trim();
    }
  }
  return src.slice(openParen + 1).trim();
}

const TABLE_RX = /from\s*\(\s*["'`]([A-Za-z0-9_]+)["'`]/g;
const OP_RX = /\.\s*(insert|upsert)\s*\(/g;
const SQL_RX = /insert\s+into\s+(?:public\.)?building_tasks\b/gi;

/** Escanea un fichero (TS/TSX o SQL) y devuelve sus operaciones de creación. */
export function scanBuildingTaskWrites(file: string, source: string): WriteOp[] {
  const ops: WriteOp[] = [];
  if (/\.sql$/i.test(file)) {
    SQL_RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SQL_RX.exec(source))) {
      const end = source.indexOf(";", m.index);
      ops.push({
        file,
        kind: "sql",
        op: /on\s+conflict/i.test(source.slice(m.index, end < 0 ? undefined : end)) ? "upsert" : "insert",
        payload: source.slice(m.index, end < 0 ? source.length : end).trim(),
        line: lineOf(source, m.index),
      });
    }
    return ops;
  }

  // TS/TSX: se empareja cada `.insert(`/`.upsert(` con la tabla del `from()`
  // inmediatamente anterior, y con su payload real (argumento equilibrado).
  OP_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OP_RX.exec(source))) {
    const prefix = source.slice(0, m.index);
    TABLE_RX.lastIndex = 0;
    let table: string | null = null;
    let t: RegExpExecArray | null;
    while ((t = TABLE_RX.exec(prefix))) table = t[1];
    if (table !== "building_tasks") continue;
    const openParen = m.index + m[0].length - 1;
    ops.push({
      file,
      kind: "ts",
      op: m[1] as "insert" | "upsert",
      payload: balancedArg(source, openParen),
      line: lineOf(source, m.index),
    });
  }
  return ops;
}

/**
 * Clasifica el inventario completo. Devuelve las violaciones: operación en un
 * archivo no autorizado, operación de más dentro de un helper autorizado, o
 * payload que no es la fila validada del helper.
 */
export function classifyBuildingTaskWrites(
  ops: readonly WriteOp[],
  sources: Readonly<Record<string, string>>,
): { authorized: WriteOp[]; violations: Violation[] } {
  const authorized: WriteOp[] = [];
  const violations: Violation[] = [];
  const perFile = new Map<string, number>();

  for (const op of ops) {
    const rule = AUTHORIZED_WRITERS[op.file];
    if (!rule) {
      violations.push({
        file: op.file,
        line: op.line,
        reason: `${op.op} no clasificado sobre building_tasks (payload: ${op.payload.slice(0, 80)})`,
      });
      continue;
    }
    const n = (perFile.get(op.file) ?? 0) + 1;
    perFile.set(op.file, n);
    if (n > 1) {
      violations.push({ file: op.file, line: op.line, reason: `escritura extra en el helper ${rule.id}` });
      continue;
    }
    if (!rule.payload.test(op.payload)) {
      violations.push({
        file: op.file,
        line: op.line,
        reason: `payload no validado en ${rule.id}: ${op.payload.slice(0, 80)}`,
      });
      continue;
    }
    if (!rule.requires.test(sources[op.file] ?? "")) {
      violations.push({ file: op.file, line: op.line, reason: `${rule.id} escribe sin validar la fila` });
      continue;
    }
    authorized.push(op);
  }
  return { authorized, violations };
}
