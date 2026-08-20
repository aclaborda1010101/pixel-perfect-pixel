# Corregir propietarios y cuotas de HubSpot

## Objetivo
Garantizar que todos los contactos asociados a negocios del universo estén reflejados en la ficha del edificio y aplicar una fuente única de porcentajes por edificio.

## Implementación
1. **Sincronización por negocio**
   - Ampliar el proceso de sincronización para recorrer las asociaciones contacto–negocio de todos los negocios vinculados a edificios.
   - Crear o enlazar de forma idempotente los propietarios y sus relaciones en `building_owners`, conservando los contactos familiares como influenciadores sin derecho.
   - Registrar el cursor/resultado y programar una ejecución periódica protegida contra solapes.

2. **Precedencia de cuotas**
   - Calcular por edificio si todas las cuotas CRM necesarias están presentes y suman `100 ± 0,75`.
   - En ese caso, usar exclusivamente las cuotas CRM, marcar el origen como **CRM validado** y verificar el edificio.
   - En cualquier otro caso, conservar exclusivamente la lógica registral actual; no mezclar fuentes ni alterar edificios sin cuotas CRM completas.

3. **Calidad de nombres**
   - Detectar nombres que probablemente contienen varias personas y listarlos en la bandeja de revisión existente, sin separarlos automáticamente.

4. **Ficha y pruebas**
   - Mostrar de forma visible si los porcentajes proceden de **CRM** o de **nota registral**.
   - Añadir una prueba de regresión que confirme que cuotas CRM completas prevalecen sobre las de la nota.
   - Validar Amparo 92 en datos y pantalla, cuantificar el saneamiento global, ejecutar tests/typecheck y escáner, desplegar funciones y publicar.

## Controles
- Procesos idempotentes y sin duplicar propietarios ni relaciones.
- La regla CRM se aplica a nivel de edificio completo, nunca por propietario aislado.
- Los edificios sin cuotas CRM válidas mantienen exactamente su fuente registral actual.
