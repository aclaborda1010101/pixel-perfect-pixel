/**
 * GUARDA DE ARQUITECTURA — escritores de `building_tasks`.
 *
 * Inventario REAL por ANÁLISIS ESTRUCTURAL (AST TypeScript para TS/TSX,
 * análisis léxico de sentencias para SQL). No hay allowlist por archivo:
 *  - la unidad autorizada es la FUNCIÓN/RPC exacta y su CONTRATO;
 *  - si el destino de `.from(x).insert/upsert` no puede resolverse, se falla
 *    CERRADO (violación), nunca se ignora;
 *  - `update`/`delete` de ciclo de vida NO son creación y no cuentan.
 */
import ts from "typescript";

export type WriteOp = {
  file: string;
  kind: "ts" | "sql";
  op: "insert" | "upsert" | "merge" | "update" | "delete" | "rpc";
  /** Texto del payload emparejado con la operación (objeto TS o cuerpo SQL). */
  payload: string;
  line: number;
  /** Función/RPC que contiene la operación (`null` si es de nivel superior). */
  fn: string | null;
  /** Tabla resuelta (o nombre de RPC si op="rpc"); `null` = no resoluble. */
  table: string | null;
  /** Motivo cuando el destino no se pudo resolver. */
  unresolved?: string;
  /** Posición absoluta en el fuente (para dominancia validador→escritura). */
  pos: number;
  /** Identificador del payload cuando es una variable (contrato TS). */
  payloadIdent: string | null;
};

export type Violation = { file: string; line: number; reason: string };

type TsRule = {
  id: string;
  /** Validador que DEBE dominar la operación dentro de la MISMA función. */
  validator: string;
  /** `assert`: validator(row). `builder`: const row = validator(input). */
  mode: "assert" | "builder";
};

/**
 * Operaciones autorizadas: clave `<archivo>#<función exportada>`.
 * Nada más puede crear filas en building_tasks.
 */
export const AUTHORIZED_WRITERS: Record<string, TsRule> = {
  "supabase/functions/_shared/taskWriters.ts#insertV5CanonicalTask": {
    id: "v5_canonica_motor",
    validator: "assertV5CanonicalTaskRow",
    mode: "assert",
  },
  "src/lib/taskWriters.ts#insertManualBuildingTask": {
    id: "manual_humana",
    validator: "buildManualTaskRow",
    mode: "builder",
  },
  "supabase/functions/_shared/taskWriters.ts#insertGeneratedTask": {
    id: "generador_continuo_v1",
    validator: "assertGeneratedTaskRow",
    mode: "assert",
  },
};

/** RPC SQL autorizadas: clave `<esquema>.<función>` + contrato exigido. */
export type SqlRule = {
  id: string;
  /** Deben aparecer ANTES de la escritura y a profundidad 0 (dominancia). */
  requiresBefore: RegExp[];
  /** Deben aparecer en el cuerpo (contrato de la fila escrita). */
  requires: RegExp[];
};

export const AUTHORIZED_SQL_WRITERS: Record<string, SqlRule> = {
  "public.commit_v5_generation_plan": {
    id: "v5_commit_plan",
    requiresBefore: [/v5_assert_canonical_task_key\s*\(/i],
    requires: [/'production'/],
  },
  "public.create_manual_building_task": {
    id: "manual_rpc",
    requiresBefore: [/manual_subtype/i],
    requires: [/'manual'/],
  },
};

/**
 * Writers RETIRADOS: importarlos o llamarlos desde cualquier módulo es una
 * violación. El histórico sólo se LEE (parseLegacyHistoricTaskKey).
 */
export const RETIRED_WRITERS = ["insertV5CallQueueTask", "insertBuildingTaskLegacy"] as const;

/** Mutaciones DML directas autorizadas en TS/TSX: NINGUNA (la UI usa RPC). */
export const AUTHORIZED_TS_MUTATIONS: Record<string, string> = {};

/** RPC de mutación de tareas autorizadas: nombre -> unidad(es) de llamada. */
export const AUTHORIZED_TASK_RPCS: Record<string, { id: string; units: string[] }> = {
  start_building_task: { id: "lifecycle_start", units: ["src/lib/taskStart.ts#startBuildingTask"] },
  reopen_building_task: { id: "lifecycle_reopen", units: ["src/lib/taskStart.ts#reopenBuildingTask"] },
  resolve_building_task: { id: "lifecycle_resolve", units: ["src/lib/taskStart.ts#resolveBuildingTask"] },
  create_manual_building_task: { id: "manual_rpc", units: [] },
  commit_v5_generation_plan: {
    id: "v5_runtime_commit",
    units: ["supabase/functions/v5_task_runtime/index.ts#commitPlan"],
  },
  claim_v5_generation_requests: {
    id: "v5_runtime_claim",
    units: ["supabase/functions/v5_task_runtime/index.ts#claimRequests"],
  },
  release_v5_generation_request: {
    id: "v5_runtime_release",
    units: ["supabase/functions/v5_task_runtime/index.ts#releaseRequest"],
  },
  reap_v5_generation_leases: {
    id: "v5_runtime_reap",
    units: ["supabase/functions/v5_task_runtime/index.ts#reapExpiredLeases"],
  },
  request_v5_generation: { id: "v5_request", units: [] },
};

/** Nombres de RPC que el inventario considera "de tareas" (no toda la app). */
export const TASK_RPC_RX = /(building_task|_v5_generation|task_runtime)/i;

/** Mutaciones SQL (update/delete) autorizadas por función + contrato. */
export const AUTHORIZED_SQL_MUTATORS: Record<string, SqlRule> = {
  "public.start_building_task": {
    id: "lifecycle_start", requiresBefore: [/FOR UPDATE/i], requires: [/auth\.uid\(\)/i],
  },
  "public.reopen_building_task": {
    id: "lifecycle_reopen", requiresBefore: [/FOR UPDATE/i], requires: [/auth\.uid\(\)/i],
  },
  "public.resolve_building_task": {
    id: "lifecycle_resolve", requiresBefore: [/FOR UPDATE/i], requires: [/auth\.uid\(\)/i],
  },
  "public.commit_v5_generation_plan": {
    id: "v5_commit_plan", requiresBefore: [/lease/i], requires: [],
  },
  // Cierre llegado desde HubSpot: sólo servidor, bloquea la fila y respeta
  // los estados terminales (no reabre ni pisa nada ya cerrado).
  "public.hubspot_apply_task_status": {
    id: "lifecycle_hubspot_inbound",
    requiresBefore: [/FOR UPDATE/i],
    requires: [/v_actual/i],
  },
};

/** DML de nivel superior autorizada en migraciones (clasificación histórica). */
export const AUTHORIZED_SQL_TOPLEVEL: Record<string, { id: string; requires: RegExp[] }> = {
  "supabase/pending_migrations/20260811230000_v5_engine_phase_a.sql#update": {
    id: "clasificacion_historico_legacy",
    requires: [/generation_mode\s*=\s*'legacy'/i],
  },
  // Limpieza puntual y ya aplicada de las tareas de prueba de un solo comercial.
  "supabase/migrations/20260812122136_31f2fd61-403e-4b77-a8fb-86faf098c70d.sql#delete": {
    id: "limpieza_puntual_tareas_prueba",
    requires: [/user_id\s*=\s*'[0-9a-f-]{36}'/i, /task_key\s+LIKE\s+'v5:gen1:%'/i],
  },
};

const TABLE = "building_tasks";

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
// TS / TSX — AST
// ---------------------------------------------------------------------------

type Resolved = { table: string | null; sawFrom: boolean; reason?: string };

/** Tabla resuelta a un valor distinto de building_tasks (no es objetivo). */

function scanTs(file: string, source: string): WriteOp[] {
  const sf = ts.createSourceFile(
    file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** const NAME = "literal" */
  const strings = new Map<string, string>();
  /** const NAME = { a: "tabla_a", b: "tabla_b" } */
  const objects = new Map<string, string[]>();
  /** const NAME = db.from("x") — variable ya "anclada" a una tabla */
  const boundTables = new Map<string, Resolved>();
  /** alias: const A = B */
  const aliases = new Map<string, string>();
  /** const NAME = new Set(["a","b"]) */
  const sets = new Map<string, string[]>();

  /**
   * Conjunto de valores posibles de una expresión de tabla.
   * `null` = NO resoluble (fail-closed).
   */
  function literalsOf(n: ts.Node | undefined, seen = new Set<string>(), depth = 0): string[] | null {
    if (!n || depth > 20) return null;
    if (ts.isStringLiteralLike(n)) return [n.text];
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) {
      return literalsOf(n.expression, seen, depth + 1);
    }
    if (ts.isConditionalExpression(n)) {
      const a = literalsOf(n.whenTrue, seen, depth + 1);
      const b = literalsOf(n.whenFalse, seen, depth + 1);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) {
      const root = n.expression;
      // Acceso a un objeto constante de tablas: se consideran TODOS sus valores.
      if (ts.isIdentifier(root) && objects.has(root.text)) return objects.get(root.text)!;
      return null;
    }
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (seen.has(name)) return null;
      seen.add(name);
      if (strings.has(name)) return [strings.get(name)!];
      const alias = aliases.get(name);
      if (alias) {
        if (strings.has(alias)) return [strings.get(alias)!];
        if (objects.has(alias)) return objects.get(alias)!;
        return null;
      }
      const guarded = guardedLiterals(name);
      if (guarded) return guarded;
      return resolveParameter(n, seen, depth + 1);
    }
    return null;
  }

  /**
   * Allowlist dominante: `if (!SET.has(x)) throw ...` con SET literal acota
   * los valores posibles de `x` a ese conjunto (nada dinámico se cuela).
   */
  function guardedLiterals(name: string): string[] | null {
    let found: string[] | null = null;
    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node) &&
          ts.isPrefixUnaryExpression(node.expression) &&
          node.expression.operator === ts.SyntaxKind.ExclamationToken) {
        const call = node.expression.operand;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
            call.expression.name.text === "has" &&
            ts.isIdentifier(call.expression.expression) &&
            sets.has(call.expression.expression.text) &&
            call.arguments[0] && ts.isIdentifier(call.arguments[0]) &&
            (call.arguments[0] as ts.Identifier).text === name &&
            node.thenStatement.getText(sf).includes("throw")) {
          found = sets.get(call.expression.expression.text)!;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }

  /**
   * Parámetro de función: se resuelve por TODOS sus call-sites del fichero.
   * Si algún call-site no es resoluble, el parámetro tampoco lo es.
   */
  function resolveParameter(id: ts.Identifier, seen: Set<string>, depth: number): string[] | null {
    let cur: ts.Node | undefined = id.parent;
    while (cur) {
      const params = (cur as ts.SignatureDeclaration).parameters as
        ts.NodeArray<ts.ParameterDeclaration> | undefined;
      if (params) {
        const i = params.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
        if (i >= 0) {
          const fnName =
            (ts.isFunctionDeclaration(cur) && cur.name?.text) ||
            ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
              cur.parent && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)
              ? cur.parent.name.text : null);
          if (!fnName) return null;
          const out: string[] = [];
          let ok = true;
          let calls = 0;
          const visitCalls = (node: ts.Node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
                node.expression.text === fnName) {
              calls++;
              const vals = literalsOf(node.arguments[i], new Set(seen), depth + 1);
              if (!vals) ok = false;
              else out.push(...vals);
            }
            ts.forEachChild(node, visitCalls);
          };
          visitCalls(sf);
          return ok && calls > 0 ? out : null;
        }
      }
      cur = cur.parent;
    }
    return null;
  }

  // Paso 1: mapa de constantes/objetos/aliases.
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "Set") {
        const arg = init.arguments?.[0];
        if (arg && ts.isArrayLiteralExpression(arg)) {
          const vals: string[] = [];
          let ok = true;
          for (const el of arg.elements) {
            if (ts.isStringLiteralLike(el)) vals.push(el.text); else ok = false;
          }
          if (ok) sets.set(name, vals);
        }
      }
      if (ts.isStringLiteralLike(init)) strings.set(name, init.text);
      else if (ts.isIdentifier(init)) aliases.set(name, init.text);
      else if (ts.isObjectLiteralExpression(init)) {
        const vals: string[] = [];
        let ok = true;
        for (const p of init.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) vals.push(p.initializer.text);
          else ok = false;
        }
        if (ok) objects.set(name, vals);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // Paso 2: resolución del receptor de la operación.
  function resolveReceiver(node: ts.Expression, depth = 0): Resolved {
    if (depth > 40) return { table: null, sawFrom: false };
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return resolveReceiver(node.expression, depth + 1);
    }
    if (ts.isAwaitExpression(node)) return resolveReceiver(node.expression, depth + 1);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from") {
        const arg = node.arguments[0];
        const lits = literalsOf(arg);
        if (lits && lits.includes(TABLE)) return { table: TABLE, sawFrom: true };
        if (lits) return { table: lits[0] ?? "", sawFrom: true };
        return {
          table: null, sawFrom: true,
          reason: `destino de .from(${arg ? arg.getText(sf) : ""}) no resoluble`,
        };
      }
      return resolveReceiver(callee, depth + 1);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return resolveReceiver(node.expression, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const bound = boundTables.get(node.text);
      if (bound) return bound;
      const alias = aliases.get(node.text);
      if (alias && boundTables.has(alias)) return boundTables.get(alias)!;
    }
    return { table: null, sawFrom: false };
  }

  // Paso 2b: variables ancladas a un `.from(...)` (posible multilínea/helper).
  const bindTables = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const r = resolveReceiver(node.initializer as ts.Expression);
      if (r.sawFrom) boundTables.set(node.name.text, r);
    }
    ts.forEachChild(node, bindTables);
  };
  bindTables(sf);
  bindTables(sf); // segunda pasada: encadenamientos entre variables

  function enclosingFn(node: ts.Node): string | null {
    let cur: ts.Node | undefined = node.parent;
    while (cur) {
      if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
      if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
      if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
          cur.parent && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) {
        return cur.parent.name.text;
      }
      cur = cur.parent;
    }
    return null;
  }

  const ops: WriteOp[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === "rpc") {
        const lits = literalsOf(node.arguments[0]);
        const nombres = lits ?? [null];
        for (const rpcName of nombres) {
          if (rpcName !== null && !TASK_RPC_RX.test(rpcName)) continue;
          ops.push({
            file, kind: "ts", op: "rpc",
            payload: node.getText(sf).slice(0, 120),
            payloadIdent: null,
            line: lineOf(source, node.getStart(sf)),
            pos: node.getStart(sf),
            fn: enclosingFn(node),
            table: rpcName,
            unresolved: rpcName === null ? "nombre de RPC no resoluble" : undefined,
          });
        }
      }
      if (name === "insert" || name === "upsert" || name === "update" || name === "delete") {
        const recv = resolveReceiver(node.expression.expression);
        const isTarget = recv.table === TABLE || (recv.sawFrom && recv.table === null);
        if (isTarget) {
          const arg = node.arguments[0];
          ops.push({
            file, kind: "ts", op: name as WriteOp["op"],
            payload: arg ? arg.getText(sf) : "",
            payloadIdent: arg && ts.isIdentifier(arg) ? arg.text : null,
            line: lineOf(source, node.getStart(sf)),
            pos: node.getStart(sf),
            fn: enclosingFn(node),
            table: recv.table,
            unresolved: recv.table === null ? (recv.reason ?? "destino no resoluble") : undefined,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ops;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SQL_WRITE_RX =
  /\b(insert\s+into|merge\s+into|upsert\s+into|update|delete\s+from)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
const SQL_FN_RX =
  /create\s+(?:or\s+replace\s+)?function\s+("?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;

const unquote = (s: string) => s.replace(/"/g, "").trim().toLowerCase();

export type SqlFnRange = {
  name: string;
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
  /** true si el cuerpo dollar-quoted no se pudo delimitar (fail-closed). */
  unterminated: boolean;
};

/**
 * Rangos REALES de cuerpo de función: se localiza la etiqueta dollar-quote
 * (`$$`, `$fn$`, …) de apertura y su cierre EXACTO. Nada que caiga fuera de
 * [bodyStart, bodyEnd] pertenece a la función, por muy cerca que esté.
 */
export function sqlFunctionRanges(source: string): SqlFnRange[] {
  const out: SqlFnRange[] = [];
  SQL_FN_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SQL_FN_RX.exec(source))) {
    const schema = m[1] ? unquote(m[1].replace(/\.\s*$/, "")) : "public";
    const name = `${schema}.${unquote(m[2])}`;
    const tagRx = /\$([A-Za-z0-9_]*)\$/g;
    tagRx.lastIndex = m.index + m[0].length;
    const open = tagRx.exec(source);
    if (!open) {
      out.push({ name, headerStart: m.index, bodyStart: m.index, bodyEnd: m.index, unterminated: true });
      continue;
    }
    const closeIdx = source.indexOf(open[0], open.index + open[0].length);
    out.push({
      name,
      headerStart: m.index,
      bodyStart: open.index + open[0].length,
      bodyEnd: closeIdx < 0 ? source.length : closeIdx,
      unterminated: closeIdx < 0,
    });
    if (closeIdx > 0) SQL_FN_RX.lastIndex = Math.max(SQL_FN_RX.lastIndex, closeIdx);
  }
  return out;
}

function sqlEnclosing(source: string, index: number): SqlFnRange | null {
  for (const r of sqlFunctionRanges(source)) {
    if (index > r.bodyStart && index < r.bodyEnd) return r;
  }
  return null;
}

/** Cuerpo de la función que CONTIENE `index`; cadena vacía si es top-level. */
export function sqlFunctionBody(source: string, index: number): string {
  const r = sqlEnclosing(source, index);
  return r ? source.slice(r.bodyStart, r.bodyEnd) : "";
}

/** Profundidad de bloques (IF/LOOP/CASE) en un fragmento de PL/pgSQL. */
export function plpgsqlDepth(fragment: string): number {
  const abre = (fragment.match(/\bif\b[^;]*?\bthen\b/gi) ?? []).length +
    (fragment.match(/\bloop\b/gi) ?? []).length -
    (fragment.match(/\bend\s+loop\b/gi) ?? []).length * 2;
  const cierra = (fragment.match(/\bend\s+if\b/gi) ?? []).length;
  return abre - cierra;
}

function scanSql(file: string, source: string): WriteOp[] {
  const ops: WriteOp[] = [];
  SQL_WRITE_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SQL_WRITE_RX.exec(source))) {
    const raw = m[2];
    const parts = raw.split(".").map(unquote);
    if (parts[parts.length - 1] !== TABLE) continue;
    const end = source.indexOf(";", m.index);
    const body = source.slice(m.index, end < 0 ? source.length : end);
    const verbo = m[1].toLowerCase();
    const op: WriteOp["op"] = /^merge/.test(verbo)
      ? "merge"
      : /^update/.test(verbo)
        ? "update"
        : /^delete/.test(verbo)
          ? "delete"
          : /on\s+conflict/i.test(body) ? "upsert" : "insert";
    const encl = sqlEnclosing(source, m.index);
    ops.push({
      file, kind: "sql", op,
      payload: body.trim(),
      payloadIdent: null,
      line: lineOf(source, m.index),
      pos: m.index,
      fn: encl && !encl.unterminated ? encl.name : null,
      table: TABLE,
      unresolved: encl?.unterminated ? "cuerpo dollar-quoted sin cierre" : undefined,
    });
  }
  return ops;
}

/** Usos (import o llamada) de writers retirados: siempre violación. */
export function scanRetiredWriterUsage(file: string, source: string): Violation[] {
  if (/\.sql$/i.test(file)) return [];
  const out: Violation[] = [];
  for (const name of RETIRED_WRITERS) {
    const rx = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(source))) {
      out.push({
        file, line: lineOf(source, m.index),
        reason: `writer legacy retirado en uso: ${name}`,
      });
    }
  }
  return out;
}

export function scanBuildingTaskWrites(file: string, source: string): WriteOp[] {
  return /\.sql$/i.test(file) ? scanSql(file, source) : scanTs(file, source);
}

// ---------------------------------------------------------------------------
// Clasificación por función + contrato
// ---------------------------------------------------------------------------

type FnRange = { start: number; end: number };

function fnRange(sf: ts.SourceFile, fnName: string): FnRange | null {
  let range: FnRange | null = null;
  const visit = (node: ts.Node) => {
    const matches =
      (ts.isFunctionDeclaration(node) && node.name?.text === fnName) ||
      (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === fnName) ||
      ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parent && ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name) && node.parent.name.text === fnName);
    if (matches && !range) range = { start: node.getStart(sf), end: node.getEnd() };
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return range;
}

/** Verifica que el validador domine la operación dentro de la misma función. */
function checkTsContract(
  op: WriteOp, rule: TsRule, source: string,
): string | null {
  if (!op.payloadIdent) {
    return `${rule.id}: el payload insertado debe ser la variable validada (${op.payload.slice(0, 60)})`;
  }
  const sf = ts.createSourceFile(
    op.file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(op.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const range = fnRange(sf, op.fn ?? "");
  if (!range) return `${rule.id}: no se localiza la función ${op.fn}`;

  let validatorPos: number | null = null;
  let mutationPos: number | null = null;
  const visit = (node: ts.Node) => {
    const start = node.getStart(sf);
    if (start >= range!.start && node.getEnd() <= range!.end) {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === rule.validator) {
        if (rule.mode === "assert") {
          const a = node.arguments[0];
          if (a && ts.isIdentifier(a) && a.text === op.payloadIdent) validatorPos = start;
        } else {
          const decl = node.parent;
          if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) &&
              decl.name.text === op.payloadIdent) validatorPos = start;
        }
      }
      // Mutación del payload (reasignación o escritura de propiedad).
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const unwrap = (e: ts.Expression): ts.Expression =>
          ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
            ? unwrap(e.expression) : e;
        let root = unwrap(node.left);
        while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
          root = unwrap(root.expression);
        }
        if (ts.isIdentifier(root) && root.text === op.payloadIdent) mutationPos = start;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (validatorPos === null) {
    return `${rule.id}: la operación no está dominada por ${rule.validator}(${op.payloadIdent})`;
  }
  if (validatorPos > op.pos) {
    return `${rule.id}: ${rule.validator} no precede a la escritura`;
  }
  if (mutationPos !== null && mutationPos > validatorPos && mutationPos < op.pos) {
    return `${rule.id}: ${op.payloadIdent} se muta después de validar y antes de escribir`;
  }
  return null;
}

/**
 * Contrato SQL: la operación debe estar DENTRO del cuerpo de la función
 * autorizada, la validación debe precederla en el mismo cuerpo y a
 * profundidad 0 (no rama muerta), sobre las mismas variables escritas, y no
 * puede haber mutaciones posteriores de la tabla en el mismo cuerpo.
 */
function checkSqlContract(
  op: WriteOp, rule: SqlRule, source: string,
): string | null {
  const range = sqlFunctionRanges(source).find((r) => r.name === op.fn && op.pos > r.bodyStart && op.pos < r.bodyEnd);
  if (!range) return `${rule.id}: la operación no está dentro del cuerpo de ${op.fn}`;
  const antes = source.slice(range.bodyStart, op.pos);
  const cuerpo = source.slice(range.bodyStart, range.bodyEnd);
  for (const rx of rule.requires) {
    if (!rx.test(cuerpo)) return `${rule.id}: la definición no cumple el contrato (${rx})`;
  }
  for (const rx of rule.requiresBefore) {
    const local = new RegExp(rx.source, rx.flags.replace("g", "") + "g");
    let ok = false;
    let m: RegExpExecArray | null;
    while ((m = local.exec(antes))) {
      // Validación a profundidad 0: nunca en una rama que pueda no ejecutarse.
      if (plpgsqlDepth(antes.slice(0, m.index)) <= 0) { ok = true; break; }
    }
    if (!ok) return `${rule.id}: la definición no cumple el contrato antes de escribir (${rx})`;
  }
  if (plpgsqlDepth(antes) > 0) {
    return `${rule.id}: la escritura está en una rama condicional no dominada`;
  }
  return null;
}

export function classifyBuildingTaskWrites(
  ops: readonly WriteOp[],
  sources: Readonly<Record<string, string>>,
): { authorized: WriteOp[]; violations: Violation[] } {
  const authorized: WriteOp[] = [];
  const violations: Violation[] = [];
  const perUnit = new Map<string, number>();

  for (const op of ops) {
    if (op.table === null) {
      violations.push({
        file: op.file, line: op.line,
        reason: `fail-closed: ${op.unresolved ?? "destino no resoluble"}`,
      });
      continue;
    }

    if (op.kind === "sql") {
      const src = sources[op.file] ?? "";
      if (!op.fn) {
        const rule = AUTHORIZED_SQL_TOPLEVEL[`${op.file}#${op.op}`];
        if (rule && rule.requires.every((rx) => rx.test(op.payload))) {
          authorized.push(op);
          continue;
        }
        violations.push({
          file: op.file, line: op.line,
          reason: `${op.op} SQL de NIVEL SUPERIOR sobre building_tasks (fuera de toda función autorizada)`,
        });
        continue;
      }
      const rule =
        op.op === "update" || op.op === "delete"
          ? AUTHORIZED_SQL_MUTATORS[op.fn]
          : AUTHORIZED_SQL_WRITERS[op.fn];
      if (!rule) {
        violations.push({
          file: op.file, line: op.line,
          reason: `${op.op} SQL no autorizado sobre building_tasks (fn: ${op.fn})`,
        });
        continue;
      }
      const problema = checkSqlContract(op, rule, src);
      if (problema) {
        violations.push({ file: op.file, line: op.line, reason: problema });
        continue;
      }
      authorized.push(op);
      continue;
    }

    if (op.op === "rpc") {
      const rpc = AUTHORIZED_TASK_RPCS[String(op.table)];
      const unit = `${op.file}#${op.fn ?? ""}`;
      if (!rpc) {
        violations.push({
          file: op.file, line: op.line,
          reason: `RPC de tareas no autorizada: ${op.table} en ${unit}`,
        });
        continue;
      }
      if (rpc.units.length > 0 && !rpc.units.includes(unit)) {
        violations.push({
          file: op.file, line: op.line,
          reason: `${rpc.id}: callsite no autorizado (${unit})`,
        });
        continue;
      }
      authorized.push(op);
      continue;
    }

    if (op.op === "update" || op.op === "delete") {
      const unit = `${op.file}#${op.fn ?? ""}`;
      if (!AUTHORIZED_TS_MUTATIONS[unit]) {
        violations.push({
          file: op.file, line: op.line,
          reason: `DML directa (${op.op}) sobre building_tasks prohibida en ${unit}: usa el RPC de ciclo de vida`,
        });
        continue;
      }
      authorized.push(op);
      continue;
    }

    const unit = `${op.file}#${op.fn ?? ""}`;
    const rule = AUTHORIZED_WRITERS[unit];
    if (!rule) {
      violations.push({
        file: op.file, line: op.line,
        reason: `${op.op} no autorizado sobre building_tasks en ${unit} (payload: ${op.payload.slice(0, 60)})`,
      });
      continue;
    }
    const n = (perUnit.get(unit) ?? 0) + 1;
    perUnit.set(unit, n);
    if (n > 1) {
      violations.push({ file: op.file, line: op.line, reason: `escritura extra en ${rule.id}` });
      continue;
    }
    const problema = checkTsContract(op, rule, sources[op.file] ?? "");
    if (problema) {
      violations.push({ file: op.file, line: op.line, reason: problema });
      continue;
    }
    authorized.push(op);
  }
  return { authorized, violations };
}
