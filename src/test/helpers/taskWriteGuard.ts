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
  op: "insert" | "upsert" | "merge";
  /** Texto del payload emparejado con la operación (objeto TS o cuerpo SQL). */
  payload: string;
  line: number;
  /** Función/RPC que contiene la operación (`null` si es de nivel superior). */
  fn: string | null;
  /** Tabla resuelta; `null` = no resoluble (fail-closed). */
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
  "supabase/functions/_shared/taskWriters.ts#insertV5CallQueueTask": {
    id: "v5_call_queue_historico",
    validator: "assertV5CallQueueRow",
    mode: "assert",
  },
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
};

/** RPC SQL autorizadas: clave `<esquema>.<función>` + contrato exigido. */
export const AUTHORIZED_SQL_WRITERS: Record<string, { id: string; requires: RegExp[] }> = {
  "public.commit_v5_generation_plan": {
    id: "v5_commit_plan",
    requires: [/v5_assert_canonical_task_key\s*\(/i, /'production'/],
  },
  "public.create_manual_building_task": {
    id: "manual_rpc",
    requires: [/'manual'/, /manual_subtype/i],
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

function scanTs(file: string, source: string): WriteOp[] {
  const sf = ts.createSourceFile(
    file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** const NAME = "literal" */
  const strings = new Map<string, string>();
  /** const NAME = db.from("x") — variable ya "anclada" a una tabla */
  const boundTables = new Map<string, Resolved>();
  /** alias: const A = B */
  const aliases = new Map<string, string>();

  const literalOf = (n: ts.Node | undefined): string | null => {
    if (!n) return null;
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isIdentifier(n)) return resolveIdentString(n.text, new Set());
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) return literalOf(n.expression);
    return null;
  };
  function resolveIdentString(name: string, seen: Set<string>): string | null {
    if (seen.has(name)) return null;
    seen.add(name);
    if (strings.has(name)) return strings.get(name)!;
    const alias = aliases.get(name);
    return alias ? resolveIdentString(alias, seen) : null;
  }

  // Paso 1: mapa de constantes/aliases.
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (ts.isStringLiteralLike(node.initializer)) strings.set(name, node.initializer.text);
      else if (ts.isIdentifier(node.initializer)) aliases.set(name, node.initializer.text);
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
        const lit = literalOf(arg);
        if (lit !== null) return { table: lit, sawFrom: true };
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
      if (name === "insert" || name === "upsert") {
        const recv = resolveReceiver(node.expression.expression);
        const isTarget = recv.table === TABLE || (recv.sawFrom && recv.table === null);
        if (isTarget) {
          const arg = node.arguments[0];
          ops.push({
            file, kind: "ts", op: name as "insert" | "upsert",
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
  /\b(insert\s+into|merge\s+into|upsert\s+into)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
const SQL_FN_RX =
  /create\s+(?:or\s+replace\s+)?function\s+("?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;

const unquote = (s: string) => s.replace(/"/g, "").trim().toLowerCase();

function sqlEnclosingFn(source: string, index: number): string | null {
  SQL_FN_RX.lastIndex = 0;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = SQL_FN_RX.exec(source))) {
    if (m.index > index) break;
    const schema = m[1] ? unquote(m[1].replace(/\.$/, "")) : "public";
    last = `${schema}.${unquote(m[2])}`;
  }
  return last;
}

/** Definición completa de la función SQL que contiene `index`. */
export function sqlFunctionBody(source: string, index: number): string {
  SQL_FN_RX.lastIndex = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = SQL_FN_RX.exec(source))) {
    if (m.index > index) break;
    start = m.index;
  }
  const tag = /\$([A-Za-z0-9_]*)\$/.exec(source.slice(start, index));
  const end = tag ? source.indexOf(tag[0], index) : -1;
  return source.slice(start, end < 0 ? source.length : end + (tag ? tag[0].length : 0));
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
    ops.push({
      file, kind: "sql",
      op: /^merge/i.test(m[1]) ? "merge" : /on\s+conflict/i.test(body) ? "upsert" : "insert",
      payload: body.trim(),
      payloadIdent: null,
      line: lineOf(source, m.index),
      pos: m.index,
      fn: sqlEnclosingFn(source, m.index),
      table: TABLE,
    });
  }
  return ops;
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
        const left = node.left;
        const root = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)
          ? left.expression : left;
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
      const rule = op.fn ? AUTHORIZED_SQL_WRITERS[op.fn] : undefined;
      if (!rule) {
        violations.push({
          file: op.file, line: op.line,
          reason: `${op.op} SQL no autorizado sobre building_tasks (fn: ${op.fn ?? "nivel superior"})`,
        });
        continue;
      }
      const body = sqlFunctionBody(sources[op.file] ?? "", op.pos);
      const falta = rule.requires.find((rx) => !rx.test(body));
      if (falta) {
        violations.push({
          file: op.file, line: op.line,
          reason: `${rule.id}: la definición no cumple el contrato (${falta})`,
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
