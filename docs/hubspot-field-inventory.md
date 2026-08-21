# Inventario de campos HubSpot

Fuente canónica del inventario: `CONTACT_PROPERTIES` para lectura y `MAPA_CAMPOS_CONTACTO` para escritura.

## HubSpot → aplicación

- Identidad y contacto: nombre, apellidos, email, teléfonos, DNI/NIF/CIF.
- Clasificación: etapa, estado del lead, tipología, fuente, distrito, relación familiar, profesión y situación.
- Propiedad: porcentaje de participación, tipo de derecho y dirección del edificio.
- Diagnóstico comercial: WhatsApp abierto, predisposición a vender, interés en reunión, bloqueo, razón de no venta, decisión individual/familiar, residencia en el edificio, liquidez, motivación/urgencia, oferta previa, biografía y canal preferido.
- Operación: fechas de creación/modificación y responsable.

Los valores se conservan en `owners.metadatos` con su nombre interno de HubSpot. `whatsapp_abierto` autorizado se materializa además en `owners.consentimiento` y `wa_consent_signals`, de forma idempotente.

## Aplicación → HubSpot

- Situación comercial, interlocutor, influenciador, participación, consentimiento WhatsApp, última llamada, próxima acción y tipología.
- Prioridad de originación, pieza decisoria, predisposición a vender y quién/qué bloquea.

La escritura sigue condicionada por los interruptores administrativos y por la existencia real de cada propiedad en el portal.

## Bidireccionales

- Tipología, participación, consentimiento/WhatsApp, predisposición y bloqueo.
- En lectura, HubSpot prevalece como fuente comercial. Las escrituras se validan contra el catálogo real del portal y nunca crean propiedades nuevas.

## Solo aplicación

- Evidencia literal, confianza, procedencia y fecha de detección del consentimiento.
- Resultados derivados del checklist y del briefing, incluyendo la procedencia visible de cada dato conocido.