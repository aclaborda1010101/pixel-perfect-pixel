
# Reestructuración AFFLUX — "Copiloto Comercial"

## Diagnóstico

La app actual mezcla **MVP, F2 y F3** del PRD en un único nivel de navegación (11 entradas planas) y obliga al usuario a saltar entre tablas inconexas. Según la auditoría cruzada (v1.3), el MVP real es mucho más estrecho:

> *"El sistema se enfoca en el ciclo de vida de una única interacción comercial: la llamada telefónica. Llamada → Análisis → Acción Sugerida es el único objetivo de este MVP."*

Y solo debe tener **2 pantallas principales**: `Dashboard de Actividad` y `Análisis de Llamada`. Todo lo demás (Matching, Cadencias, Investors, Buildings, Compliance UI, WhatsApp) es F2/F3.

## Principios de la nueva estructura

1. **Tres zonas claras por rol**, no 11 entradas planas:
   - **Hoy** (operación diaria del agente — el Copiloto)
   - **Datos** (catálogo: propietarios, activos, edificios, inversores)
   - **IA & Gobierno** (matching, cadencias, compliance, ajustes — uso ocasional, manager)
2. **Wizards guiados** para las 2 acciones de alto valor: *"Preparar llamada"* y *"Analizar llamada"*. Nada de formularios sueltos.
3. **Jerarquía Activo → Propietario(s)**, no propietarios huérfanos. Al abrir un activo ves a sus propietarios y al abrir una llamada el contexto va precargado.
4. **Lo del PRD que es F2/F3 se marca como tal** con badge "Próximamente / Beta", se mantiene accesible pero fuera del flujo principal.

## Nueva navegación (sidebar agrupado)

```text
HOY  (Copiloto Comercial - foco MVP)
  • Inicio              (qué hago ahora: cola de llamadas + acciones pendientes)
  • Llamadas            (Dashboard de Actividad del PRD)
  • Nueva llamada  ➜    wizard 4 pasos

DATOS  (catálogo, lectura/edición)
  • Activos             (entrada principal — agrupa propietarios y edificio)
  • Propietarios        (vista alterna, filtrable por rol)
  • Edificios
  • Inversores          [F2]

IA & GOBIERNO  (manager / ocasional)
  • Matching            [F2]
  • Cadencias           [F2]
  • Compliance
  • Ajustes
```

Los grupos del sidebar son colapsables. Las entradas F2 llevan un badge sutil "Beta" para que el usuario distinga MVP de extras.

## Pantalla 1 — `Inicio` (sustituye al Dashboard genérico)

Ya no son 4 KPIs huérfanos. Es una pantalla de **trabajo del día**:

- **Banda superior**: 3 KPIs accionables → "Llamadas pendientes de analizar", "Acciones sugeridas sin cerrar", "Propietarios sin rol catalogado".
- **Cola "Listo para revisar"**: tabla de las últimas llamadas en estado `Analizando / Listo`, click ➜ pantalla de Análisis.
- **Tarjeta "¿Qué quieres hacer?"** con dos CTAs grandes:
  - `Preparar una llamada` ➜ wizard
  - `Analizar una llamada nueva` ➜ wizard

## Pantalla 2 — `Análisis de Llamada` (la del PRD, bien hecha)

Layout en 2 columnas tal y como dice la auditoría:

- **Cabecera**: Propietario · Activo asociado · Rol (badge con confianza) · Fecha · Duración.
- **Columna izquierda**: `Resumen Ejecutivo` (≤150 palabras) + `Acciones Sugeridas` (1-2-3 numeradas, con botón "Crear como Next Action").
- **Columna derecha con pestañas**:
  - `Transcripción` (timestamps + speakers)
  - `Consultar historial (RAG)` — chat sobre el propietario, citando llamadas/notas fuente.
  - `Notas` (libres del agente)
- **Pie**: botón "Iniciar cadencia" (F2, badge Beta).

## Wizard "Preparar llamada" (4 pasos, 1 propósito)

Resuelve directamente lo que pediste ("selecciona activo → propietario → enfoca la llamada"):

```text
Paso 1  Activo o propietario      (buscador con autocomplete)
Paso 2  Propietario concreto       (lista de propietarios del activo + rol)
Paso 3  Brief Pre-Call (IA)        (PreCallBrief actual: contexto, última llamada,
                                    objeciones previas, recomendación de enfoque
                                    según rol)
Paso 4  Empezar                    (botón "Marcar llamada iniciada" + acceso
                                    rápido a "Subir grabación" cuando termine)
```

## Wizard "Analizar llamada" (3 pasos)

```text
Paso 1  Subir grabación (.mp3/.wav)   o pegar transcripción manual
Paso 2  Asociar a propietario/activo  (preselección si vino del wizard anterior)
Paso 3  Procesar                      (transcripción mock + análisis IA → 
                                       redirige a "Análisis de Llamada")
```

## Cambios concretos por archivo

| Archivo | Cambio |
|---|---|
| `src/components/layout/AppSidebar.tsx` | Reagrupar items en 3 secciones (Hoy / Datos / IA & Gobierno) con `SidebarGroupLabel` y badges "Beta" para F2. |
| `src/pages/Dashboard.tsx` → renombrar a `Inicio.tsx` | Reemplazar 4 KPIs por: 3 KPIs accionables + cola "Listo para revisar" + 2 CTAs grandes a los wizards. |
| `src/pages/Calls.tsx` | Convertir en el `Dashboard de Actividad` del PRD: tabla con `Propietario / Fecha / Duración / Estado / Agente` + botón `[+] Subir Grabación`. |
| **NUEVO** `src/pages/CallAnalysis.tsx` (`/llamadas/:id`) | Pantalla 2 del PRD (2 columnas + pestañas). Reusa `AnalyzeNote` y `RagSearch`. |
| **NUEVO** `src/pages/wizards/PrepareCallWizard.tsx` (`/preparar-llamada`) | 4 pasos. Reutiliza `PreCallBrief`. |
| **NUEVO** `src/pages/wizards/AnalyzeCallWizard.tsx` (`/analizar-llamada`) | 3 pasos. Crea fila en `calls`, llama a `agent_analyze_note`, redirige a `CallAnalysis`. |
| `src/pages/Assets.tsx` | Añadir columna "Propietarios" (count + popover con nombres y rol). Click en activo ➜ `/activos/:id` con propietarios y llamadas asociadas. |
| **NUEVO** `src/pages/AssetDetail.tsx` | Vista jerárquica Activo → Propietarios → Llamadas → Acciones. |
| `src/pages/OwnerDetail.tsx` | Quitar pestaña "Comms" del flujo principal (queda solo accesible vía Cadencias F2). Mover botón "Catalogar rol" a la cabecera. Simplificar pestañas: `Resumen / Llamadas / Activos / Acciones / IA`. |
| `src/pages/Matching.tsx`, `Investors.tsx`, `Cadences.tsx` | Añadir banner "Funcionalidad Fast-Follow (F2)". Sin cambios funcionales. |
| `src/pages/Compliance.tsx` | Añadir explicación de qué dispara casos automáticos (DPIA, consentimiento, Art. 22) — actualmente es opaco. |
| `src/App.tsx` | Añadir rutas `/`, `/preparar-llamada`, `/analizar-llamada`, `/llamadas/:id`, `/activos/:id`. Renombrar Dashboard → Inicio. |
| `src/i18n/translations.ts` | Añadir strings ES/EN para wizards, nueva nav, badges "Beta", banners F2. |

## Lo que NO cambia (intencionadamente)

- Esquema de base de datos y edge functions ya construidas. Todo se reutiliza.
- Componentes IA existentes (`PreCallBrief`, `AnalyzeNote`, `RagSearch`, `CatalogRoleButton`, `ValuatorButton`) — solo cambian de sitio para encajar en los wizards.
- Tema claro/oscuro, i18n ES/EN, sin login (siguen las decisiones aprobadas).

## Lo que queda fuera de este sprint

- Soul Capture real (es proceso humano, no software).
- Subida real de audio + transcripción (Whisper). En el wizard "Analizar llamada" se acepta texto pegado o grabación mock; el pipeline real se aborda después.
- Detector de fallecimientos, compradores institucionales, generador de revista (F2/F3 según PRD).

## Resultado esperado

Un agente nuevo entra, ve **"Inicio"** con dos botones gigantes (`Preparar llamada` / `Analizar llamada`), sigue el wizard paso a paso y nunca tiene que entender qué es un "match candidate" o un "cadence step" para hacer su trabajo. El manager sí tiene acceso a Matching/Cadencias/Compliance, pero en su propio grupo del sidebar.
