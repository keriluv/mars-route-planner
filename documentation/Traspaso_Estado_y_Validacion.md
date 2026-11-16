# Traspaso: estado de GaleX y continuación de validaciones

Fecha: 15 de noviembre de 2026. Corte de código: `0cec44d` (antes del commit de este reporte). Ruta: `/home/wuisino/Projects/mars-route-planner`.

## Objetivo y decisiones del usuario

GaleX es un prototipo local para planificar y simular exploración humana EVA en Marte. Curiosity y Perseverance son **robots no presurizados para personas** y fuentes de datos de referencia; sus trayectos no demuestran que una ruta sea segura para una persona. Se desea consultar sus posiciones publicadas en los mapas oficiales de NASA, sin calificarlas como telemetría en directo, y generar rutas propias considerando, entre otros, viento, polvo, radiación y terreno. Gale y Jezero son regiones deseadas, pero no tienen capacidades de planificación equivalentes actualmente. Los refugios, estaciones y parámetros de EVA y meteorología utilizados para demostración no son hechos operacionales verificados.

El usuario pidió continuar implementando y validando por prioridad, mantener commits separados por cambio y evitar procedimientos de entrega. El artifact remoto no se pudo abrir; sí se analizó la exportación `suggestion models/Misión Marte_ plan de entrega (Copy).html`. El reto se consultó en `/home/wuisino/Downloads/NASA Space Apps Challenge.html`; puede no estar disponible en otro entorno. Los modelos de `suggestion models/` son referencias, no validaciones. Ver `Contexto_Integral_y_Artifact.md`, `Analisis_Producto_y_Prioridades.md` y `Plan_Implementacion_y_Validacion_GaleX.md`.

## Estado de Git y precauciones

- Rama observada: `feature/trek.nasa.gov/mars/API`. Consultar `git status --short` y `git log --oneline` antes de actuar.
- `Planificacion_por_Fases.md` tiene modificaciones preexistentes del usuario y `suggestion models/` está sin seguimiento; conservarlos y no incluirlos incidentalmente en commits.
- No se realizó publicación, despliegue ni entrega. No borrar datos, artefactos o copias documentales sin comprobar su uso y procedencia.

## Implementado

**Rutas y seguridad.** La API valida región, coordenadas, número de paradas y perfil; solo Gale tiene planificación habilitada con las capas verificadas. A* valida grillas y costos, bloquea celdas no válidas y diagonales que cruzan esquinas, escala su heurística por costo mínimo y no desplaza automáticamente paradas bloqueadas. El planificador conserva la ruta densa, calcula recursos sin redondeo prematuro y aplica reservas, duración y dosis configuradas. Valida el refugio respecto al centro de celda final y devuelve por parada el ajuste de grilla. Las cifras son aproximaciones de demostración.

**Cliente y EVA.** La aceptación requiere una respuesta válida ligada a geometría, región y perfil; se conservan puntos y distancias del servidor y se muestran ajustes de paradas. La simulación acumula un balance local demostrativo de oxígeno, batería, tiempo y dosis durante marcha y descanso, lo muestra en pantalla, comprueba autonomía/horario al reanudar y recorta pasos al primer límite de recursos, horario o destino. Los descansos que agotarían autonomía o alcanzarían la noche se rechazan; el salto nocturno está deshabilitado sin refugio y política de reposición. Los desvíos y cambios locales durante la EVA están deshabilitados hasta disponer de validación completa del recorrido restante. La alerta de tormenta está identificada como hipotética y no afirma una replanificación inexistente.

**Base para replanificación.** El cálculo de recursos y el planificador aceptan un estado previo. `POST /api/route` admite opcionalmente `initial_resources` con `oxygen_pct`, `battery_pct`, `eva_time_min` y `radiation_dose_msv`, todos obligatorios y numéricos si se envía el objeto. El servidor valida rangos pero no la procedencia de los valores. **El balance de la simulación existe localmente, pero no se envía a la API ni habilita replanificación.** Esta aclaración prevalece sobre el párrafo anterior de `Registro_Validaciones.md` que dice que la simulación aún no mantiene el estado.

**Rovers.** Existe un modal con mapas oficiales de Curiosity y Perseverance y enlaces de respaldo. No se ha comprobado su carga real en navegador, ni esos mapas alimentan el planificador o proporcionan posición offline.

**Reportes.** Validación del autor, coordenadas y adjuntos; cola de reportes con ID en `localStorage`, recuperación tras recarga y reintentos al recuperar servidor/red, con comprobación periódica. El servidor sustituye por ID, permitiendo reintentos idempotentes. La interfaz distingue guardado local, pendiente y fallo de almacenamiento. La cola no garantiza sincronización entre pestañas ni cubre mensajes, misiones o telemetría.

## Validación disponible y límites

Las pruebas cubren solicitudes y recursos EVA, límites de marcha/descanso, consistencia parcial de tasas cliente-servidor, obstáculos, nodata, diagonales, costos, distancia, reservas, aprobación, cola de reportes, serialización y smoke tests. Ejecutar desde la raíz:

```bash
python -m pytest -q
node --test tests/*.cjs
git diff --check
```

Las pruebas de coherencia Python ejecutan Node. En esta revisión pasaron **49 pruebas Python en 75,40 s** y los **tres archivos de pruebas JavaScript**; `git diff --check` también pasó. El smoke test de ruta extensa tarda considerablemente más que los dirigidos. Estas pruebas no sustituyen un flujo integral.

**No comprobado:** interacción real en navegador, accesibilidad, visualización 2D/3D, carga y bloqueo de iframes NASA, reinicio de servidor con datos reales, múltiples pestañas, sesiones prolongadas y operación offline integral. No se ha hecho validación científica ni evaluación de seguridad operacional. No interpretar las pruebas automatizadas como evidencia de esos puntos.

## Riesgos y trabajo pendiente, en orden sugerido

1. **Validación integrada prioritaria.** Levantar el servidor local sin modificar datos del usuario y realizar en navegador el flujo completo: región, planificación válida/rechazada, ajustes, aceptación, reproducción, descanso, límites, alertas, aborto, reconexión y persistencia. Contrastar lo mostrado con las respuestas y recursos reales. Registrar versiones y resultados; probar fallos y solicitudes tardías. Verificar el comportamiento al cambiar de tripulante/región y reiniciar.
2. **Replanificación real.** Unificar el estado temporal y de recursos del cliente con el contrato del servidor, incluyendo consumos ya realizados, reservas y exposición; definir instantánea, validación, rechazo y concurrencia, y comparar ruta anterior/nueva sin aplicar cambios hasta aprobación. Mantener el recorrido anterior y la pausa ante fallos. No enviar un estado fabricado ni asumir que el servidor verifica su procedencia. Resolver coherencia de tasas, velocidad y límites; parámetros están duplicados y las pruebas solo cubren algunos escenarios.
3. **Ambiente reproducible.** Modelar viento, polvo y otras variables por región, ubicación y tiempo, con semilla, unidades y procedencia; asociar efectos explícitos a costos/bloqueos y verificar que modifiquen la ruta o causen rechazo. La alerta actual es guionizada y no afecta el planificador. No presentar mediciones puntuales de rovers como condiciones regionales actuales.
4. **Datos regionales y fuentes.** Auditar Jezero, su DEM constante y posibles usos de capas Gale; elaborar manifiestos de CRS, extensión, nodata, resolución, fecha y procedencia antes de habilitar planificación. Comparar trayectos NASA con tramos y objetivos equivalentes, sin confundir similitud con seguridad humana. Verificar mapas oficiales y su fecha de actualización.
5. **Persistencia.** Diseñar identificadores estables e idempotencia para mensajes, misiones y telemetría antes de agregar reintentos durables. Verificar cola de reportes en navegador, almacenamiento lleno, reconexión y múltiples pestañas; la implementación actual no garantiza coordinación entre pestañas.
6. **Ajustes y calidad del planificador.** Revisar tolerancia de desplazamiento de paradas y aceptación explícita; verificar A* contra Dijkstra, objetivos científicos y exactitud de límites. Evitar afirmar inexistencia de solución factible cuando se evalúa solo una candidata. Auditar validaciones de entradas y coherencia de distancias/pendientes.
7. **Medición y mantenimiento.** Medir inicio, primera ruta, rutas repetidas, memoria y sesiones largas antes de optimizar; definir hardware y metas con el equipo. Diseñar invalidación de cachés por región/datos/perfil/escenario. Revisar código heredado de rover y duplicaciones de documentación con cautela.

## Decisiones que requieren conversación

Reservas, umbrales y parámetros EVA científicos; criterio de descanso y reposición en refugios hipotéticos; tolerancia máxima de ajuste de paradas; cobertura y prioridad de variables ambientales; alcance offline, hardware y objetivos de rendimiento; si además de la web local se requiere una aplicación de escritorio. Hasta acordarlos, rotular escenarios como hipotéticos y evitar afirmar seguridad operacional.

## Referencias de código y commits

- Planificador y recursos: `src/marsroute/planner.py`, `src/marsroute/multicriteria.py`, `src/marsroute/domain.py`, `config/route_profiles.yaml`.
- API y persistencia: `backend/server.py`, `backend/schema.sql`, `src/marsroute/storage.py`, `web/js/api.js`.
- Simulación e interfaz: `web/js/core.js`, `web/js/app.js`, `web/js/route-validation.js`, `web/index.html`.
- Cobertura y limitaciones: `documentation/Registro_Validaciones.md`; los tests están en `tests/`.
- Historial de cambios de esta etapa: desde `266c3e2` hasta `0cec44d`; ejecutar `git log --oneline 266c3e2^..HEAD` para detalle. Los commits previos son parte del proyecto y no deben atribuirse automáticamente a esta etapa.
