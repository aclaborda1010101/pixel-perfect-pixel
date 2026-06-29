## Objetivo

Darte un coste aproximado en € por conversación completa del bot de WhatsApp con un lead, basado en datos reales del AI Gateway (no estimaciones de manual).

## Datos reales medidos (últimas conversaciones)

He revisado los logs reales del AI Gateway. Cada **turno** del bot (1 mensaje del lead → 1 respuesta del bot) dispara **2 llamadas a Gemini 3 Flash**:

| Llamada | Tokens típicos | Coste/turno |
|---|---|---|
| Clasificador de puerta (A–F) | ~500–800 in / ~100 out | ~0,0006–0,0008 |
| Respuesta principal (con contexto CRM, historial, perfil) | ~7.500 in / ~200 out | ~0,0043–0,0047 |
| **Total por turno** | | **~0,0050–0,0055** |

Unidad: créditos del **AI Gateway** (balance de IA Cloud), no créditos del plan Pro.

## Coste por conversación

Asumiendo una conversación típica de **10 turnos** (10 mensajes del lead + 10 respuestas del bot):

- **~0,05 créditos AI Gateway por conversación de 10 turnos**
- Conversación corta (3 turnos): ~0,015
- Conversación larga (20 turnos): ~0,10

## Conversión a euros

Los créditos del AI Gateway están denominados en **USD** (el balance gratuito mensual es de $1). La equivalencia es **1 crédito ≈ 1 USD ≈ 0,93 €**.

Por tanto:
- **Conversación típica (10 turnos): ~0,05 € (5 céntimos)**
- Conversación corta: ~1,5 céntimos
- Conversación larga: ~10 céntimos

Con el **balance gratuito de $1/mes** del AI Cloud que incluye Lovable, te dan margen para **~20 conversaciones completas gratis al mes** antes de tirar de saldo extra.

## Validación que voy a hacer cuando me apruebes el plan

1. Agrupar los logs del Gateway **por `run_id`** de las últimas 24h filtrando solo las llamadas que vienen de `wa_ai_reply` (bot de WhatsApp), no de las otras 30+ edge functions (escaleras, scoring, valuator, briefings, etc.).
2. Calcular media real **por conversación cerrada** (no por turno): sumar tokens y coste de todos los turnos asociados a un mismo `wa_conversation_id`.
3. Devolverte una tabla con: nº de conversaciones medidas, media de turnos, media de coste en créditos y €, y el rango (mín–máx).

Así tendrás el número real con tu tráfico actual, no una estimación teórica.

## Lo que NO voy a tocar

Nada de código. Es solo lectura de logs y cálculo.