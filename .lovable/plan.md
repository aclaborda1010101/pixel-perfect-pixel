Plan para arreglar el fallo del bot de WhatsApp sin tocar el resto del CRM:

1. Capturar multimedia entrante en el webhook
- Actualizar `evolution_webhook` para detectar mensajes entrantes de tipo audio, imagen y documento/PDF, no solo texto.
- Guardar el mensaje en `wa_messages` con `type` correcto (`audio`, `image`, `document`) y metadatos del payload original.
- Si entra multimedia, dejarlo marcado como `processing` y lanzar un procesamiento antes de encolar respuesta del bot.

2. Procesar audios, imágenes y documentos
- Crear una edge function `wa_process_incoming_media`.
- Para audios: descargar el contenido desde Evolution, transcribirlo con Lovable AI Speech-to-Text y guardar la transcripción en `content`.
- Para imágenes/PDF/documentos: analizar el archivo con Lovable AI multimodal y guardar una descripción útil en castellano, orientada a detectar datos del lead/edificio.
- Guardar estado y errores en `metadata.media_processing`, sin romper mensajes antiguos.

3. Bloquear respuestas hasta tener el contenido procesado
- Cambiar `wa_ai_reply` para que ignore/posponga conversaciones con el último entrante multimedia aún sin procesar.
- Así Lucía no volverá a preguntar lo mismo porque el audio “parecía vacío”.
- Cuando termine el procesamiento, lanzar entonces `wa_ai_reply` con el texto transcrito/descrito ya dentro del historial.

4. Hacer que Lucía use transcripciones como contexto real
- Ajustar el prompt de `wa_ai_reply` para indicar que mensajes tipo audio/imagen/documento ya procesados cuentan como historial válido.
- Reforzar que no repita preguntas si la respuesta ya aparece en una transcripción o documento.
- Mantener el flujo solo entrante: no campañas, no plantillas, no inicio automático de conversación.

5. Reducir duplicados del bot
- Añadir una protección contra jobs/respuestas duplicadas cuando llegan varios webhooks o audios seguidos.
- Antes de responder, comprobar el último mensaje saliente del bot y evitar repetir exactamente la misma pregunta/frase en una ventana corta.

6. Mostrar multimedia en `/whatsapp`
- Ampliar la query de mensajes para traer `media_url`/metadata.
- Renderizar burbujas profesionales para audio, imagen y documento: estado “procesando”, transcripción/descripción cuando exista, y error si falla.
- Mantener el diseño actual del módulo WhatsApp.

7. Validación final
- Revisar que el flujo sigue siendo: lead escribe primero -> webhook guarda -> procesa si hay multimedia -> bot responde solo si procede.
- Confirmar explícitamente que no se envía ninguna plantilla saliente automática en este flujo.