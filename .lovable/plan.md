## 1. Fix de la "Tasa de respuesta" (bug 200%)

Hoy se calcula `enviados / recibidos` (en `WhatsappDashboard.tsx`). Si enviamos 6 y nos contestan 3 sale 200%, que no tiene sentido.

Cambio a una métrica honesta y acotada a 0–100%:

> **% de conversaciones contactadas en 24h que han respondido**  
> = `conversaciones con mensaje OUT y, después, un mensaje IN en 24h` / `conversaciones con OUT en 24h`

Se calcula con un par de queries adicionales (`distinct conversation_id` sobre `wa_messages` filtrando dirección y ventana 24h). Hint del tile: "Han respondido / contactadas".

## 2. Catalogación del rol del lead (usando los enums que ya tenemos)

Los enums ya existen en la BD:

- `owner_role`: `particular`, `heredero`, `inversor_pasivo`, `operador_profesional`, `institucional`, `desconocido`.
- `owner_subrole`: `ninguno`, `heredero_operador`, `heredero_residente`, `heredero_ausente`, `heredero_conflictivo`, `arrendador`, `usufructuario`, `nudo_propietario`, `apoderado`.

### Migración

Añadir a `wa_conversations`:

- `rol_owner owner_role NULL`
- `subrol_owner owner_subrole NULL`
- `rol_source text` (`'ia'` o `'manual'`) y `rol_confianza numeric`.

GRANT correspondiente a `authenticated` y `service_role`.

### IA (extensión de `wa_ai_reply`)

- Ampliar el JSON `qualification_update` con dos campos opcionales: `rol_owner` y `subrol_owner`, sólo si el lead lo dice con claridad.
- En el prompt añadir las definiciones de cada rol/subrol con ejemplos cortos (ej. "lo gestiona mi tía y yo no vivo allí" → `heredero` / `heredero_ausente`).
- Mejorar la regla de `relacion_copropietarios` para capturar relaciones familiares indirectas: cuando alguien diga "lo lleva mi tía/madre/hermano…", rellenar con frase corta tipo "Sobrino — gestiona la tía" en lugar de dejarlo vacío.
- Si la IA marca un rol con confianza ≥ 0.7, persistir en `rol_owner` con `rol_source='ia'`. Si el comercial fija uno, pasa a `'manual'` y la IA ya no lo pisa.

### Edición manual del comercial

En la ficha del lead, dos `Select` (rol + subrol) con los valores de los enums. Al cambiar, se guarda con `rol_source='manual'`.

## 3. Rediseño de la ficha del lead (panel derecho del Inbox)

Hoy es una columna de tarjetitas iguales con "Stage", "Resumen", y los 5 campos en bruto. Cuesta ver de un vistazo qué tenemos. Se reorganiza en 4 bloques con jerarquía y estado por campo:

```text
┌─ IDENTIDAD ────────────────────────────────┐
│  Nombre · Teléfono                         │
│  Stage  ·  [Rol ▼]  [Subrol ▼]             │
└────────────────────────────────────────────┘
┌─ VÍNCULO CON LA PROPIEDAD ─────────────────┐
│  Gestiona el edificio    ✅ / ⚠ / —        │
│  Vive en el edificio     ✅ / ⚠ / —        │
│  Relación familiar       texto             │
└────────────────────────────────────────────┘
┌─ DATOS COMERCIALES ────────────────────────┐
│  Cuadro de rentas        ✅ / —            │
│  Último mensaje          hace 2h           │
└────────────────────────────────────────────┘
┌─ RESUMEN IA · PRÓXIMO PASO ────────────────┐
│  (texto del resumen actual + Regenerar)    │
└────────────────────────────────────────────┘
```

Cada bloque con eyebrow + icono. Para los campos booleanos/sí-no usamos `✅` (sí), `—` (sin dato) y `⚠` (negativo o riesgo). Se añade un bloque colapsable "Campos pendientes" con los huecos para que el comercial vea qué falta sin ruido.

Cambios visibles concretos sobre el caso Alejandro:

- Aparece "Sobrino — gestiona la tía" en *Relación familiar* en lugar del actual "falta".
- Rol = `heredero`, Subrol = `heredero_ausente` (sugeridos por la IA, editables).
- Stage en color y tipografía consistente con el resto del CRM.

## 4. Lista de conversaciones

Tanto en `Inbox` (lista izquierda) como en `Resumen · Inbox · Recientes` se añade un chip pequeño con el subrol o, si no hay, el rol. Si no se conoce, se omite el chip.

## 5. Detalle técnico (para mí)

- **Migración**: dos columnas + GRANT en `wa_conversations`.
- **Edge function `wa_ai_reply`**:
  - `allowed` añade `rol_owner` y `subrol_owner`.
  - Prompt: bloque nuevo con definiciones y ejemplos; regla específica para "lo gestiona mi familiar".
  - Persistencia: si vienen rol/subrol válidos y el row no tiene `rol_source='manual'`, escribirlos.
- **`wa_summarize`**: recibe el rol/subrol en el `userPrompt` para que el resumen los use.
- **Frontend** (`WhatsappDashboard.tsx`):
  - Refactor del panel derecho del `InboxView` en cuatro `<section>` con la estructura de arriba.
  - Selects controlados con los enums (`rol_owner`, `subrol_owner`); update directo a `wa_conversations` y `invalidate`.
  - Nuevo cálculo del tile "Tasa de respuesta" + nuevo `hint`.
  - Chip de rol en las dos listas.
- **Sin tocar**: el resto del CRM, el P0 de scoring, ni el pipeline `escaleras-visor-madrid`.

## Fuera de alcance

- No tocamos el bot `wa_send_message` ni la conexión Evolution.
- No cambiamos los demás tiles del Resumen ni el panel de "Pipeline".
- No añadimos roles nuevos: usamos los enums existentes.
