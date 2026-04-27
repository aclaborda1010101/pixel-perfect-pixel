# Plan — MVP AFFLUX

CRM operativo con IA, RAG, matching activo↔inversor, compliance/HITL y canales mock. Frontend React + Vite + Tailwind, backend Lovable Cloud, modelos vía Lovable AI Gateway. Bilingüe ES/EN con selector y tema claro/oscuro. Sin login en esta iteración (acceso abierto en preview); seed de datos ficticios incluido.

> Aviso: el alcance completo es muy grande. Propongo construirlo en **5 fases** dentro del mismo plan. Tras aprobarlo, ejecutaremos fase a fase y validaremos antes de pasar a la siguiente.

---

## Identidad visual y base UX

- Tipografía sans neutra, layout tipo CRM (sidebar izquierda + contenido).
- Tokens semánticos en `index.css` para soportar **claro/oscuro** (toggle en topbar, persistido en localStorage).
- Selector **ES/EN** en topbar, traducciones con un diccionario simple (sin librería pesada). ES por defecto.
- Sidebar con: Dashboard, Propietarios, Edificios, Activos, Llamadas, Inversores, Matching, Compliance, Cadencias/WhatsApp, Ajustes.
- Componentes: shadcn/ui ya disponibles (Card, Table, Dialog, Tabs, Badge, Sheet, Form, Toast).
- Indicadores transversales: chip de estado de compliance, badge "Requiere revisión humana", badge "Mock".

---

## Fase 1 — Fundación CRUD navegable

Objetivo: app completamente navegable con datos reales antes de tocar IA.

**Esquema (Lovable Cloud / Postgres):**
- `owners`, `buildings`, `assets`, `investors`, `calls`, `notes`, `match_candidates`, `compliance_cases`, `next_actions`, `cadence_steps` (mock), `whatsapp_messages` (mock), `agent_runs` (auditoría), `org_settings` (umbrales).
- Campos según el pack + timestamps. Relaciones: `assets.building_id`, `assets.owner_id`, `calls.owner_id`, `notes.owner_id`, `match_candidates.asset_id/investor_id`, `compliance_cases.scope_id` (polimórfico por tipo).
- RLS habilitada con políticas permisivas temporales (acceso anónimo) marcadas con TODO para endurecer cuando añadamos auth.

**Pantallas:**
- `/` Dashboard: KPIs (propietarios activos, llamadas semana, candidatos pendientes, casos compliance abiertos) + listas de "trabajo pendiente".
- `/propietarios` listado con búsqueda/filtros + `/propietarios/:id` ficha con tabs (Datos, Notas, Llamadas, Próximas acciones, Activos vinculados).
- `/edificios` listado + ficha (datos catastrales, propietarios, activos).
- `/activos` listado con filtros (tipo, ciudad, estado, valoración) + `/activos/:id` ficha (datos, valoración, candidatos).
- `/llamadas` bandeja + detalle con resumen, transcripción (placeholder), próxima acción.
- `/inversores` listado + ficha (criterios, ticket).
- `/ajustes` umbrales por agente, idioma por defecto, responsable HITL.

**Seed:** ~15 propietarios, 8 edificios, 25 activos, 6 inversores, notas y llamadas variadas, 3 casos compliance abiertos.

---

## Fase 2 — Pipeline de llamadas y asistente pre/post

- **Subida de transcripción**: el operador pega texto o sube `.txt`/`.vtt` (storage). No haremos ASR real en MVP; transcripción se considera entrada.
- **Agente "Asistente pre-llamada"** (edge function): toma `owner_id`, recupera notas + llamadas + activos + rol clasificado, devuelve briefing estructurado (contexto, objetivos sugeridos, riesgos, preguntas clave). Botón "Generar briefing" en ficha de propietario.
- **Agente "Analizador de notas / post-llamada"**: dada una nota o transcripción, extrae hechos, intenciones y propone **próxima acción** (título, vencimiento, propietario, activo). El operador confirma → persiste en `next_actions`.
- Output estructurado vía tool calling (no JSON libre).
- Cada ejecución se registra en `agent_runs` (input hash, modelo, latencia, tokens, resultado, score de confianza).

---

## Fase 3 — RAG, catalogador y valorador

- **Tabla `knowledge_chunks`** con `pgvector` (content, embedding, source_type, source_id, owner_id?).
- Edge function de **ingesta**: trocea notas, llamadas, fichas de activo y documentos subidos en `org_documents`; genera embeddings vía Lovable AI Gateway; guarda.
- **Tres RAGs lógicos** sobre la misma tabla, filtrando por `source_type`:
  1. Conocimiento + conversaciones AFFLUX.
  2. Propietarios y llamadas.
  3. Activos y valoraciones.
- **Catalogador de roles de propietario**: agente que clasifica a un propietario (p. ej. "heredero", "inversor pasivo", "operador profesional", "particular accidental") usando reglas + LLM. Resultado guardado en `owners.role` con confianza y justificación visible.
- **Valorador con Brains Real Estate (mock)**: edge function que devuelve valoración estimada + comparables ficticios + banda de confianza. Botón "Valorar" en ficha de activo. Marcado claramente como **Mock**.
- Buscador semántico global en topbar (⌘K) consultando los 3 RAGs.

---

## Fase 4 — Matching, compliance/HITL y orquestador

- **Matching activo↔inversor**: al guardar/actualizar un activo, edge function calcula candidatos comparando criterios del inversor (ciudad, tipo, ticket, etc.) con el activo, devuelve `score (0–1)` + evidencia textual. Filtra por umbral y consentimiento. Resultados en `/matching` con cola revisable; el operador aprueba/rechaza; aprobar genera `next_action` "contactar inversor".
- **Agente Compliance / HITL** (capa transversal): antes de cualquier acción que envíe datos a tercero o trate datos sensibles, llama a `check_dpia_status` y `abstain_if_low_evidence`. Si bloquea → crea `compliance_case` con motivo y estado "pendiente revisión".
- **Pantalla `/compliance`**: cola de casos, detalle con scope, motivo, evidencia, acciones aprobar/rechazar; al aprobar, desbloquea la acción original.
- **Detector de fallecimientos / herencias**: pantalla de ingesta controlada (carga manual de señales). El agente marca posibles casos → siempre revisión humana obligatoria antes de propagar a `next_actions`.
- **Orquestador / MoE Router**: edge function única `route_intent` que recibe `{intent, payload}` y decide: ruta determinista (búsqueda por id, filtros), modelo rápido (clasificación) o modelo de razonamiento (briefing, análisis libre). Implementa fallback a modelo secundario y registro en `agent_runs`. Todos los agentes anteriores pasan por aquí.
- **Umbrales configurables** en `/ajustes` (confianza mínima por agente, responsable HITL).

---

## Fase 5 — Cadencias y WhatsApp mock

- `/cadencias` planificador visual: secuencia de pasos (día +0 llamada, +2 WhatsApp, +5 email…) por propietario o lista.
- `/whatsapp` interfaz tipo chat con propietarios: redactar, programar, ver estado.
- **Ningún envío real**: todo persiste en `whatsapp_messages` con `status: 'mock_sent'`. Banner permanente "Modo simulación, no se envían mensajes reales".
- Toda redacción de mensaje pasa por compliance/HITL antes de marcarse como enviada.

---

## Detalles técnicos

- **Edge functions** (Supabase) por agente: `agent_pre_call_brief`, `agent_analyze_note`, `agent_classify_owner`, `agent_match_candidates`, `agent_valuate_asset`, `agent_compliance_check`, `agent_death_detector`, `route_intent`, `embed_and_index`, `semantic_search`. Todas usan Lovable AI Gateway (`LOVABLE_API_KEY`), modelo por defecto `google/gemini-3-flash-preview`, razonamiento `medium` para análisis largos.
- **Tool calling** para todas las salidas estructuradas (briefing, próxima acción, candidatos, clasificación). Nunca JSON libre.
- **Auditoría**: tabla `agent_runs` con input, output, score, modelo, latencia. Visible en ficha del recurso afectado.
- **i18n**: hook `useT()` con diccionario `es`/`en` en `src/i18n/`. Persistencia en localStorage.
- **Tema**: `next-themes` o gestor propio sobre clase `dark` en `<html>`.
- **Manejo de 429/402** del gateway → toast amigable.
- **RLS**: habilitada en todas las tablas. En esta iteración, políticas anónimas de lectura/escritura (anotadas) hasta añadir auth en una siguiente iteración.
- **Vector**: extensión `pgvector` + índice IVFFlat sobre `knowledge_chunks.embedding`.

---

## Fuera de alcance (fast-follow, según el pack)

- Detector de compradores institucionales tipo Benatar.
- Generador de revista emocional por rol.
- ASR real de audio.
- Envío real por WhatsApp / scraping real de fuentes externas / scoring ML aprendido.
- Auth y roles (operador/revisor/admin) — se añadirán cuando lo decidas.

---

## Criterios de aceptación

- CRUD funcional en propietarios, edificios, activos, inversores, llamadas, notas sin errores.
- Cada propietario puede generar briefing pre-llamada bajo demanda.
- Cada nota/transcripción produce próxima acción propuesta y persistida tras confirmación.
- Cadencias y WhatsApp solo como interfaz/mock; banner visible; ningún envío real.
- Compliance/HITL bloquea acciones sensibles y las envía a revisión.
- Matching devuelve candidatos con score y justificación; exige aprobación humana.
- Valorador y detector de fallecimientos visibles y marcados como Mock.
- Idioma ES/EN y tema claro/oscuro conmutables y persistidos.
