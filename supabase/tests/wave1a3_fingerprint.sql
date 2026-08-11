-- =====================================================================
-- WAVE 1A.3 P0.5 · FINGERPRINT COMPLETO DEL ESQUEMA public
-- =====================================================================
-- Emite una linea por hecho estructural. Comparar solo nombres de
-- pg_class/pg_proc NO vale: aqui van columnas+tipos+defaults+nullability,
-- constraints (definicion y validacion), indices con predicado, definicion
-- COMPLETA de views/matviews/functions, owners y grants, secuencias,
-- triggers, enums y checksums de datos de todas las tablas base.
-- Uso: psql -At -f wave1a3_fingerprint.sql  (salida ordenada y estable)
-- =====================================================================
\pset footer off

SELECT line FROM (

-- Tablas / vistas / secuencias con su tipo y propietario
SELECT format('REL|%s|%s|%s|persist=%s|rowsec=%s',
              c.relname, c.relkind, pg_get_userbyid(c.relowner),
              c.relpersistence, c.relrowsecurity) AS line
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')

UNION ALL
-- Columnas: nombre, posicion, tipo exacto, nullability, default, identidad, colacion
SELECT format('COL|%s|%s|%s|%s|null=%s|default=%s|ident=%s|gen=%s|coll=%s',
              c.relname, a.attnum, a.attname,
              format_type(a.atttypid, a.atttypmod),
              NOT a.attnotnull,
              coalesce(pg_get_expr(d.adbin, d.adrelid), '-'),
              coalesce(nullif(a.attidentity, ''), '-'),
              coalesce(nullif(a.attgenerated, ''), '-'),
              coalesce((SELECT cl.collname FROM pg_collation cl WHERE cl.oid = a.attcollation), '-'))
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
   AND c.relkind IN ('r','p','v','m','f')

UNION ALL
-- Constraints: definicion textual completa + validacion + deferrable
SELECT format('CON|%s|%s|%s|valid=%s|deferrable=%s|%s',
              coalesce(cl.relname, '-'), con.conname, con.contype,
              con.convalidated, con.condeferrable,
              pg_get_constraintdef(con.oid, true))
  FROM pg_constraint con
  JOIN pg_namespace n ON n.oid = con.connamespace
  LEFT JOIN pg_class cl ON cl.oid = con.conrelid
 WHERE n.nspname = 'public'

UNION ALL
-- Indices: definicion completa (incluye predicado parcial y expresiones)
SELECT format('IDX|%s|%s|%s', i.tablename, i.indexname, i.indexdef)
  FROM pg_indexes i WHERE i.schemaname = 'public'

UNION ALL
-- Vistas y vistas materializadas: definicion completa
SELECT format('VIEWDEF|%s|%s', c.relname, md5(pg_get_viewdef(c.oid, true)))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v','m')

UNION ALL
-- Funciones/procedimientos: firma, volatilidad, seguridad, owner, cuerpo completo
SELECT format('FUNC|%s(%s)|kind=%s|ret=%s|vol=%s|secdef=%s|strict=%s|lang=%s|owner=%s|cfg=%s|body=%s',
              p.proname, pg_get_function_identity_arguments(p.oid),
              p.prokind, pg_get_function_result(p.oid), p.provolatile,
              p.prosecdef, p.proisstrict, l.lanname, pg_get_userbyid(p.proowner),
              coalesce(array_to_string(p.proconfig, ','), '-'),
              md5(pg_get_functiondef(p.oid)))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
 WHERE n.nspname = 'public'

UNION ALL
-- Triggers: definicion completa
SELECT format('TRG|%s|%s|%s', c.relname, t.tgname, pg_get_triggerdef(t.oid, true))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

UNION ALL
-- Politicas RLS completas
SELECT format('POL|%s|%s|%s|%s|roles=%s|using=%s|check=%s',
              pol.schemaname, pol.tablename, pol.policyname, pol.cmd,
              array_to_string(pol.roles, ','),
              coalesce(pol.qual, '-'), coalesce(pol.with_check, '-'))
  FROM pg_policies pol WHERE pol.schemaname = 'public'

UNION ALL
-- Tipos definidos por el usuario (enums con sus etiquetas ordenadas)
SELECT format('TYPE|%s|%s|%s|owner=%s', t.typname, t.typtype,
              coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                          FROM pg_enum e WHERE e.enumtypid = t.oid), '-'),
              pg_get_userbyid(t.typowner))
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'public' AND t.typtype IN ('e','d','c','r')

UNION ALL
-- GRANTS de tablas/vistas/secuencias (ACL explicita, por privilegio)
SELECT format('GRANT-REL|%s|%s|%s|%s',
              g.table_name, g.grantee, g.privilege_type, g.is_grantable)
  FROM information_schema.role_table_grants g WHERE g.table_schema = 'public'

UNION ALL
-- GRANTS de funciones
SELECT format('GRANT-FUNC|%s|%s|%s|%s',
              r.specific_name, r.grantee, r.privilege_type, r.is_grantable)
  FROM information_schema.routine_privileges r WHERE r.routine_schema = 'public'

UNION ALL
-- ACL cruda (captura tambien REVOKE de PUBLIC, que las vistas de arriba no muestran)
SELECT format('ACL|%s|%s', c.relname, coalesce(c.relacl::text, 'default'))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
UNION ALL
SELECT format('ACLF|%s(%s)|%s', p.proname,
              pg_get_function_identity_arguments(p.oid),
              coalesce(p.proacl::text, 'default'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'

UNION ALL
-- CHECKSUM DE DATOS de cada tabla base: filas y hash del contenido.
-- query_to_xml permite el SQL dinamico sin crear objetos (que alterarian
-- el propio fingerprint).
SELECT format('DATA|%s|rows=%s|md5=%s',
              c.relname,
              (xpath('/row/n/text()',
                     query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname),
                                  false, true, '')))[1]::text,
              coalesce((xpath('/row/h/text()',
                     query_to_xml(format(
                       'SELECT md5(coalesce(string_agg(h, %L ORDER BY h), %L)) AS h '
                       'FROM (SELECT md5(t.*::text) AS h FROM public.%I t) s',
                       '', 'VACIA', c.relname), false, true, '')))[1]::text, 'VACIA'))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relpersistence = 'p'

UNION ALL
-- Extensiones instaladas y su version
SELECT format('EXT|%s|%s', e.extname, e.extversion) FROM pg_extension e

) f
ORDER BY line;
