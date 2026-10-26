# Asesor RHO con voz

Primera versión: avatar ilustrado con narraciones guiadas en español. Aparece en Inicio como un botón flotante. `?asesor=1` abre el panel sin iniciar audio.

El visitante elige bienvenida, cómo comprar, envíos, facturación o pedido especial. Los enlaces llevan a las páginas vigentes. Solo pedidos especiales ofrecen WhatsApp; el enlace prepara un mensaje y el visitante decide enviarlo.

La voz usa SpeechSynthesis del dispositivo, con preferencia por español de México. No hay suscripciones, grabaciones, permisos de micrófono ni integración con IA. La animación alterna dos poses de la boca durante los eventos de reproducción; no es sincronización fonética. Sin voz disponible se ofrecen subtítulos y enlaces. Cerrar, ocultar la pestaña o navegar detiene el audio.

Textos: advisor-voice.mjs. Interfaz aislada: advisor-avatar.js y advisor-avatar.css. No consulta existencias ni promete precios o entregas particulares. Ante cambios de políticas, actualizar los mensajes y conservar enlaces vigentes.

Validación: `node --check advisor-avatar.js`, `node --test tests/advisor-voice.test.mjs`, revisión visual de escritorio, 390 px y 320 px. En el navegador remoto de revisión, SpeechSynthesis devolvió error y se comprobó la alternativa de subtítulos. La reproducción audible en un iPhone físico no se verificó.
