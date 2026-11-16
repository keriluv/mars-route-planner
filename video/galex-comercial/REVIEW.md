# Revisión V2 — navegación y cobertura completa

16 de noviembre de 2026. Solicitud del usuario: mantener la cobertura de funciones y aumentar el movimiento real del mapa, Planeta 3D y Relieve 3D, con novedades al menos cada diez segundos. V1 queda documentada en `REVIEW_V1.md` y en el commit `132b408`.

Se construyeron 18 escenas, 17 de producto y el cierre de marca, en 119,8 s. Nuevas tomas de navegación y acciones reales, producto a pantalla completa y cartelas que dejan despejada la acción después de unos cuatro segundos. Transiciones horizontales, verticales e iris de 0,6 s. Cambio de función cada 5,4–7,4 s. Se conserva el logo original y la revisión silenciosa elegida por el usuario.

## Comprobaciones

- HyperFrames 0.9.56: `ok: true`, cero errores en lint, runtime, layout, movimiento y contraste. Único aviso: `film_silent`, conservado por elección del usuario. Una información de solapamiento de indicadores de capítulo durante la transición; dura menos de 0,6 s y es intencional. Resumen en `validation-summary.json`.
- `capture/verify_media.py`: 17 medios decodificados sin errores, 30 fps y duración coincidente con el guion. Comparación de imágenes del terreno en varios instantes confirma cambios en Planeta 3D, Relieve 3D, mapa 2D y navegación regional. Esa comparación detecta movimiento; no mide rendimiento real de la aplicación. Resultados en `media-validation.json`.
- Se solicitaron 206 fotogramas de revisión de escenas y uniones. Se inspeccionaron los 36 fotogramas de inicio/mitad de las 18 escenas, hojas de contacto y transiciones representativas. La captura exhaustiva de las uniones se conserva en `.hyperframes/artifacts/snapshots/`.
- Previsualización local en el puerto 4567. No se ha exportado todavía el MP4 completo; su duración y reproducción deberán comprobarse al realizar la exportación.

## Ajustes realizados y límites

- Se regrabaron las órbitas con entradas reales de ratón y se verificó visualmente que cambian la orientación del relieve. La cadencia de captura 3D fue baja; se retimaron esas tomas y se interpolaron por mezcla temporal a 30 fps. Los originales se conservaron localmente en `capture/raw/`. La interpolación puede producir estelas en algunos detalles; no representa la tasa de cuadros del producto en el equipo del usuario.
- No se usan imágenes fijas para sostener las escenas de planificación, EVA o relieve. El mapa y los paneles se muestran en uso; los títulos permanecen estables mientras se leen.
- Se amplió la cobertura a objetivos, condiciones, fisiología, misiones y controles. Inventario en `SPEC_V2.md` y `coverage.json`. El mapa externo NASA sigue sin mostrarse porque devolvió error; se captura la comparación local existente.
- La escena más débil continúa siendo EVA: la vista cerca de Bradbury deja parte del mapa sin textura. Se muestra la interfaz tal como responde, con avance y perfil activos. No se modificó el producto para ocultar este comportamiento.
- La mezcla no se ha escuchado ni medido porque no hay audio en esta revisión. No se afirma validación científica de modelos o métricas que aparecen en la interfaz.
