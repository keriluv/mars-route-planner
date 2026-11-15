# Contexto integral de GaleX y evaluación del artifact

Fecha de análisis: 15 de noviembre de 2026. Este documento conserva el contexto para el trabajo posterior. Se basa en el código, datos y documentación locales y en `suggestion models/Misión Marte_ plan de entrega (Copy).html`; no incorpora procedimientos de entrega. El enlace remoto original no era accesible, pero la exportación local sí se pudo leer. El artifact y sus archivos son propuestas, no evidencia independiente de validación.

## Decisiones y propósito

- Producto: prototipo de apoyo a la exploración marciana, con astronauta como usuario principal y operadores/científicos como usuarios adicionales. Las rutas y observaciones de rovers aportan contexto, no equivalen a seguridad para una persona.
- Aclaración confirmada: **Curiosity y Perseverance son rovers robóticos, no presurizados para personas, y productores de información de referencia para GaleX**. Sus trayectos y datos alimentan, en teoría, la plataforma; GaleX calcula y simula sus propias rutas teniendo en cuenta esa evidencia y condiciones ambientales. El objetivo principal es apoyar una EVA humana. No asignar al rover oxígeno humano ni blindaje de pasajeros. La planificación operativa y batería de los rovers no se han solicitado como objetivo independiente.
- Ámbito funcional documentado: Gale y Jezero, origen/objetivos/refugio, alternativas de ruta, capas, consulta científica, alertas, replay, registros y operación local sin internet. La red MDA y los refugios son hipotéticos para la simulación.
- Hay tensión histórica entre «aplicación de escritorio» en el PDF y el plan posterior de aplicación web local. La implementación actual es web servida por Python. No se ha confirmado si también se necesita un contenedor de escritorio.
- El usuario solicita análisis integral y excluir los procedimientos de entrega. Los calendarios, publicación, video y checklist del artifact se excluyen de esta evaluación.

## Mapa del sistema y estado comprobado

| Componente | Evidencia y función | Alcance o incertidumbre |
|---|---|---|
| Configuración | `config/mission.yaml`, `config/regions/*.yaml`, `config/route_profiles.yaml` | Contiene regiones, perfiles y límites; no todos se consumen. Las configuraciones de regiones no son todavía un contrato único utilizado en todo el flujo. |
| Preparación de datos | `scripts/download_data.py`, `build_layers.py`, `prepare_rems.py`; `src/marsroute/layers.py` | Capas Gale 1200². REMS local en dos soles; algunas fuentes originales no están disponibles offline para regeneración completa. |
| Modelo | `src/marsroute/model.py`, `models/metrics.json`, `models/terrain_model.joblib` | Random Forest aprende parecido al corredor de Curiosity; no probabilidad calibrada de seguridad. Separación espacial por fila más próxima, no progreso temporal real. Validación: 99 positivos y un negativo. Prueba: 68/184 positivos recuperados; F1 ≈ 0,498. |
| Planificador base | `src/marsroute/planner.py`, `scripts/plan_route.py` | A* en grilla y ruta histórica precomputada. `simplify` usa Douglas-Peucker sin comprobación de obstáculos en esa función. |
| Planificador multicriterio | `src/marsroute/multicriteria.py` | Tres perfiles y recursos aproximados. Las restricciones completas, movilidad elegida y cálculo con ruta densa requieren integración/corrección. |
| Backend | `backend/server.py`, `docstore.py`, `schema.sql`, `src/marsroute/storage.py` | HTTP local, API, SQLite y JSONL. `/api/route` carga la grilla y refugios de Gale. Algunas validaciones de misiones/telemetría restringen coordenadas a Gale. |
| Cliente | `web/index.html`, `web/js/{core,app,map2d,scene3d,globe3d,api}.js` | Hay navegación, planificación de cliente, simulación, gráficos y visualizaciones. Hay cálculos y catálogos duplicados en cliente y servidor; cambio de idioma en `app.js` cubre solo algunos elementos, no se verificó traducción completa. |
| Jezero | `config/regions/jezero.yaml`, `web/data/jezero_data.js`, `jezero_layers.json` | Hay datos visuales codificados y una extensión geográfica en el cliente distinta de la configuración regional del servidor. `web/data/jezero_dem.npy` es 300×300 y todos sus valores son 6557,6475; por sí solo no sirve como DEM confiable. Existen capas visuales separadas con rango declarado −2567,2 a −1925,8 m, cuya procedencia y alineación deben verificarse independientemente. |
| Persistencia | SQLite y JSONL en `backend/data/`; preferencias en `localStorage` | Hay persistencia, pero no se verificó un flujo completo con reinicio y fallo; algunos envíos asíncronos pueden ocultar errores. No borrar la base como limpieza. |
| Vista planetaria | `web/js/globe3d.js`, `3dView/`, teselas y proxy | Hay recursos locales y caché de teselas obtenidas previamente. No está demostrado que toda región y vista funcione con caché vacía y sin internet. `3dView/dem_tiles` contiene archivos versionados. |
| Pruebas | `tests/test_smoke.py` | 7 aprobadas en 58,53 s durante la revisión previa, en el entorno existente. Incluye una prueba de rutas sobre datos reales; no prueba todos los flujos de interfaz, offline, región ni todos los límites. |

Las fechas y estados de Fase 0, así como los resultados y métricas del PDF histórico, reflejan un momento anterior. README y planes contienen tanto requisitos como afirmaciones no verificadas o inconsistentes con el código actual; por ejemplo, describen rover presurizado, reservas y replanificación como si estuvieran resueltas.

## Flujo efectivo y puntos que deben unificarse

1. La interfaz selecciona región y datos locales. En `web/js/core.js:91`, si falta una capa de Jezero, `MR.sample` puede recurrir a una capa de Gale o devolver cero; `layerRGBA` tiene una lógica similar. Esto puede presentar un dato ajeno o desconocido como si perteneciera a la región. Sustituir por estado explícito de dato ausente y probar cada capa regional.
2. La interfaz calcula rutas y recursos localmente; también llama `/api/route` para refinar rutas. La solicitud actual no identifica región ni movilidad y el servidor utiliza Gale. El resultado incluye validez, pero `web/js/app.js:940` toma la geometría sin comprobarla. Definir un único resultado autoritativo y una respuesta de fallo, con región, parámetros, procedencia y restricciones aplicadas.
3. El servidor recorta coordenadas al borde y desplaza puntos bloqueados hasta encontrar una celda libre sin informar del ajuste. Debe rechazar entradas fuera de cobertura y hacer explícitos los desplazamientos aceptados.
4. La superficie de costo utiliza pendiente y una puntuación aprendida, no todos los factores anunciados. El premio científico se aplica solamente si existe una capa `minerals`; comprobar su disponibilidad efectiva. Las rutas «rápida» y «científica» no demuestran por sus nombres que minimicen tiempo real o maximicen retorno científico.
5. El cálculo de recursos se realiza después de simplificar puntos y contiene supuestos humanos aplicados a un rover presurizado hipotético. Mantener geometría densa para cálculo y geometría simplificada solo para visualización, con pruebas de intersección, obstáculos y distancia.
6. El evento de tormenta es simulado y su botón cambia perfil y notifica éxito. En recorrido, `setRouteProfile` actualiza métricas, no genera el desvío. Conectar evento y área afectada a una solicitud real, comprobar la nueva ruta antes de anunciarla y preservar estado ante errores.
7. Los perfiles declaran reservas y `hard_constraints`; el planificador no los aplica íntegramente. Una ruta que llega con algo de oxígeno no necesariamente cumple la reserva y el límite aplicables. El `elif total_hours > 8.0` está asociado a una condición de rechazo previo, por lo que no funciona como control general de duración.

A revisar además: al bajar el costo científico hasta 0,5, la heurística euclidiana no escalada de A* puede sobreestimar el costo restante; debe probarse y ajustarse para garantizar optimalidad bajo el costo elegido. En recorridos con recursos limitados, calcular primero una sola ruta y rechazarla después puede descartar otra ruta factible: decidir si se pretende detectar factibilidad o resolver optimización con restricciones de recursos.

## Artifact: qué propone y cómo encaja

| Módulo | Propuesta | Evaluación para GaleX |
|---|---|---|
| M1 astronauta | Pendiente direccional, velocidad, Pandolf modificado, oxígeno, energía | Integrar primero como simulación humana opcional por segmento, no en rover. Preservar constantes y unidades; comparar con cálculos actuales y datos de referencia. El escalado gravitatorio y los factores de traje son hipótesis, no validación. |
| M2 traje térmico | Ciclo horario y balance simplificado | Útil para escenarios hipotéticos, condicionado a temperatura con unidades, hora y localización. La capa THEMIS actual es imagen DN de 8 bits, no temperatura calibrada; interpolar su tamaño no crea grados Celsius ni garantiza alineación geográfica. |
| M3 rutas por hora | Ruta sensible a hora de llegada y barrido de salidas | Puede aportar comparación de escenarios. En `ruta` solo se conserva una etiqueta costo/tiempo por celda; con costos dependientes de hora, una llegada de mayor costo pero distinta hora puede resultar mejor después, por lo que no se garantiza el óptimo general. Definir discretización temporal o algoritmo apropiado y contrastarlo con ejemplos pequeños exhaustivos. |
| M4 emergencia | Campo inverso desde refugios y ruta de retorno en tormenta | Idea útil para consultas frecuentes. El código evalúa correctamente la dirección vecino→refugio en su costo de tramo, pero presupone condiciones fijas, sin bloqueo dinámico completo y con reservas simplificadas. Versionar el campo por región, movilidad, refugios y escenario; invalidarlo cuando cambien. |
| M5 riesgos | Radiación, iluminación, hielo, clima | Introducir por capas solo con procedencia, resolución y alcance. La fórmula de altitud y el balance térmico son aproximaciones. Gy y Sv son magnitudes distintas; no convertir sin un modelo de dosis adecuado. La iluminación propuesta omite sombras proyectadas. |
| M6 recorridos reales | Comparar un tramo con Perseverance | El script arranca con recorrido y terreno sintéticos pese a imprimir «real». Cambiar esa etiqueta, leer el trazado realmente calculado por GaleX y verificar trazabilidad, alineación, región, fechas y objetivos comparables. La similitud con un rover no valida una EVA. |
| M7 visor | Avatar, telemetría y botón de tormenta | Aprovechar conceptos en las vistas existentes, no duplicar el producto. El visor de referencia depende de CDN y consume su propio `mision.json`, lo que requiere adaptación y prueba offline. |

La propuesta de emergencia consulta puntos cada cinco celdas: entre muestras puede cambiar la distancia y los recursos necesarios. Su estado `ALCANZA` compara oxígeno disponible y necesario sin aplicar de forma explícita toda la reserva de emergencia ni otros límites. El modelo térmico y la selección de hora no convierten una franja simulada en «hora segura» comprobada. Además, remuestrear rásteres por forma, como muestra el artifact, es insuficiente para alinear origen, extensión, proyección y resolución.

## Requisitos funcionales contrastados

- **Astronauta:** inicio, paradas, refugio hipotético final, ruta densa, recursos y reservas, condiciones de escenario, explicación, rechazo y recorrido visual. El oxígeno, tiempo, energía y dosis actuales son aproximaciones y no cubren todas las restricciones del plan. Falta decidir los parámetros aceptables y el alcance de agua/consumo metabólico.
- **Rovers como fuentes:** consumir trayectorias y observaciones de Curiosity en Gale y Perseverance en Jezero con ubicación, fecha/sol, instrumento, unidades y procedencia. Los trayectos aportan evidencia sobre lugares recorridos por un robot, no recomendaciones directas para una persona ni cobertura completa del terreno. GaleX calcula rutas propias de EVA combinando esa evidencia con restricciones y escenarios ambientales. No atribuir al rover oxígeno, refugio o consumo humano.
- **Operador/científico:** consultar capas con procedencia, eventos, estado y registro; seleccionar objetivos/materiales solo donde existan datos sustentados. Un punto de interés inferido o simulado no es una detección exacta.
- **Ambiente:** distinguir observación histórica local, derivación, simulación y dato ausente. Ninguna de estas categorías implica medición en tiempo real. Para cada variable guardar fuente, sol/hora, ubicación, resolución, unidades y suposiciones.
- **Multirregión:** un manifiesto regional debe identificar extensión, CRS/datum, grilla, cobertura, máscara, fuentes, refugios hipotéticos y versión de datos. La mera existencia de imágenes y una configuración no demuestra capacidad de cálculo equivalente.
- **Robustez operativa:** medir por separado inicio, repetición de ruta, alternativas simultáneas, simulación prolongada y uso de memoria. Definir escenarios de error y las funciones que requieren servidor local. Un service worker por sí solo no ejecuta el backend.

## Aclaración funcional: rutas propias y ecosistema marciano

El usuario confirma que Curiosity y Perseverance producen información que GaleX consumiría, y que la plataforma debe generar y simular sus propias rutas usando la evidencia de sus trayectos y condiciones ambientales. La intención incluye simular viento, polvo, radiación, suelos inestables y otras variables pertinentes. No se debe interpretar que NASA ya envía datos en vivo a esta instalación: la disponibilidad, acceso, fecha y cobertura de cada producto deben verificarse por separado.

Propuesta de arquitectura para cumplirlo:

1. **Ingesta regional:** registrar recorridos y productos de cada misión con ubicación, fecha/sol, instrumento, unidad, resolución y fuente. Una observación puntual no describe automáticamente todo el cráter; cualquier extrapolación debe identificarse y justificarse.
2. **Escenarios ambientales reproducibles:** definir estado inicial, reloj, región, semilla, eventos, duración, extensión espacial y parámetros. Permitir reproducir un caso histórico o hipotético, distinguiendo ambos.
3. **Variables:** viento con velocidad y dirección; polvo con opacidad/visibilidad y evolución; radiación con magnitud y unidad explícitas; estabilidad del suelo como indicador hipotético o derivado con incertidumbre; temperatura y topografía cuando existan datos apropiados. No inferir directamente estabilidad, toxicidad o dosis humana de una imagen o recorrido sin modelo y datos suficientes.
4. **Influencia sobre la ruta:** traducir cada variable a restricciones o costos configurables por tramo y tiempo; declarar cuándo falta un dato. Mantener la puntuación del modelo aprendido como evidencia limitada y nunca como garantía de seguridad humana.
5. **Replay y replanificación:** al cambiar un escenario, volver a evaluar posición, estado del astronauta, recursos, refugios y obstáculos; proponer una ruta realmente calculada y mostrar qué cambió, con razones y procedencia.
6. **Comprobación:** usar escenarios pequeños controlados para confirmar que cada variable afecta las rutas como se pretende, y evaluar datos históricos y trayectos reales como comparación, sin afirmar validación operacional.

La información procedente de un rover puede orientar el análisis del terreno, pero sus capacidades y objetivos no son los de un astronauta: una ruta recorrida no demuestra que sea adecuada para EVA. Los umbrales de viento, polvo, exposición y terreno deben acordarse como parámetros de simulación y revisarse por especialistas antes de cualquier interpretación operacional.

## Trabajo recomendado y criterios comprobables

1. **Línea base:** registrar entorno, datos disponibles, versiones, casos representativos y tiempos en frío/caliente; mantener los datos del usuario. Añadir pruebas pequeñas deterministas que no dependan del modelo completo y pruebas de integración seleccionadas.
2. **Corregir contratos:** enviar `region`, `mobility`, inicio, objetivos, destino, perfil y versión de escenario; validar cobertura y devolver ruta densa, resumen, alertas, validez y causas. Una solicitud Jezero nunca debe usar datos Gale silenciosamente. Astronauta y rover deben consumir modelos distintos.
3. **Corregir la factibilidad:** aplicar restricciones configuradas, máscara de datos, restricciones por tramo y reservas; controlar inicio/destino y geometría. Probar sin ruta, datos ausentes, obstáculos, desviación y reservas insuficientes. Distinguir un rechazo demostrado de la imposibilidad de encontrar solución.
4. **Conectar eventos y persistencia:** evento reproducible altera un escenario/versionado, recalcula o consulta un campo válido, muestra diferencias y maneja fallo; guardar y recuperar registro tras reinicio. Probar desconexión y capas sin caché.
5. **Incorporar M1 y M4 por etapas:** evaluar el modelo experimental humano en una ruta ya calculada; comparar consumos de ida y retorno, mantener supuestos visibles y verificar monotonicidad y unidades. Solo luego evaluar M2/M3 si hay datos y criterios para su uso.
6. **Validación y optimización:** comparar recorridos de rovers con tramos identificados y métricas bidireccionales; usar casos de referencia sintéticos y datos reales trazables. Perfilar antes de cambiar algoritmo, cachear por región/escenario/versión y medir también invalidaciones y concurrencia. No priorizar quadtree, instancias o modelos 3D hasta medir problemas reales.

## Preguntas pendientes para decisiones posteriores

1. ¿Qué variables y escenarios ambientales deben implementarse primero y con qué parámetros o rangos de demostración?
2. ¿Qué funciones deben operar sin internet y se acepta que el servidor Python local deba estar encendido? ¿Se requiere ejecutable de escritorio?
3. ¿Qué significa mayor prioridad de ejecuciones constantes: tiempo de arranque, replanificaciones repetidas, sesiones largas o usuarios simultáneos? ¿Cuál es el equipo objetivo y el tiempo tolerable?
4. ¿Qué valores de demostración y reservas usar para la EVA y quién los revisará? ¿La ruta siempre debe terminar en refugio o reserva hipotética, y cómo se interpreta la reserva de emergencia?
5. ¿Orden manual de objetivos, por proximidad o por optimización? ¿Se permite ajustar puntos bloqueados y cuánto?
6. ¿Se desea modelar temperatura y ventanas horarias con datos simulados claramente rotulados mientras no exista una capa física adecuada?

## Límites de esta revisión

Se inspeccionaron documentación, HTML, código y datos clave; no se ejecutó una prueba visual completa en navegador, una auditoría exhaustiva de todas las teselas o una validación externa de cada fuente científica. Las pruebas anteriores pasaron, pero no constituyen validación funcional ni científica completa. La copia HTML accesible reemplaza la necesidad de acceso al enlace original para leer sus propuestas; no acredita la corrección de cada fórmula o afirmación.

## Fuentes adicionales y vista de ubicación

- [Mapa oficial de Curiosity](https://science.nasa.gov/mission/msl-curiosity/location-map/) y [mapa oficial de Perseverance](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/): ubicación y recorrido publicados por NASA; no se garantiza telemetría instantánea. La vista «Rovers» integra los mapas oficiales y requiere internet. No ingiere coordenadas al planificador ni guarda una última posición offline; la fuente externa controla fechas y actualización.
- [Mars Trek](https://trek.nasa.gov/mars/): contexto y productos cartográficos; examinar cada capa, resolución y licencia antes de usarla como dato científico.
- [Mapas de Marte USGS](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) y [mapa geológico global USGS](https://pubs.usgs.gov/sim/3292/): contexto geológico; escala global no demuestra características locales como estabilidad de suelo. El portal interactivo no pudo inspeccionarse completamente desde esta revisión.
- [Ruta propuesta de Curiosity hacia Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/): propuesta histórica de 2019; no debe confundirse con recorrido efectuado o última posición.
- [Imágenes sin procesar de Perseverance](https://mars.nasa.gov/mars2020/multimedia/raw-images/): evidencia visual contextual; por sí solas no establecen coordenadas exactas de materiales ni propiedades del suelo.
- [NASA Worldview](https://worldview.earthdata.nasa.gov/): herramienta de observación terrestre; no es fuente directa de clima marciano para este proyecto.
- [Reto Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=details): el enlace no pudo abrirse desde la herramienta de consulta, por lo que los requisitos exactos no se han verificado; no sustituirlos por inferencias.
