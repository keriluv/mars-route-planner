# Plan de implementación y validación de GaleX

Fuente del reto: copia local `NASA Space Apps Challenge.html`, sección Details; referencias adicionales: [contexto integral](Contexto_Integral_y_Artifact.md), [análisis de prioridades](Analisis_Producto_y_Prioridades.md) y modelos en `suggestion models/`. Este plan no incluye procedimientos de entrega. Estado: propuesta de trabajo, no evidencia de implementación.

## Alcance y criterios de prioridad

El reto pide una vista integrada por capas de una zona o ruta marciana que utilice datos de varias misiones NASA y apoye la planificación y ejecución de una exploración humana con objetivos científicos. Sugiere considerar tres tipos de datos, rutas y seguridad; esas sugerencias no son requisitos obligatorios explícitos. Admite información histórica, proyectada o sin fecha específica. El usuario amplía el alcance a Gale y Jezero, escenarios ambientales, rutas propias, refugios hipotéticos y consulta de posiciones de rovers.

Prioridad 0: corrección de datos y rutas. Prioridad 1: simulación y emergencia reproducibles. Prioridad 2: modelos avanzados y mejoras visuales condicionadas por datos y mediciones. Las prioridades son una propuesta de ingeniería; no sustituyen decisiones del equipo.

## 1. Línea base y contratos

- Registrar versiones del código, entradas y configuración, incluyendo hashes, sin sobrescribir bases de datos ni resultados existentes. Reproducir los siete smoke tests y medir por separado arranque, rutas individuales, tres perfiles y repetición; conservar equipo, memoria y tiempos observados.
- Definir `Region`, `Layer`, `Scenario`, `RouteRequest`, `RouteResult`, `Observation` y `Report` con versión, unidades y estado de procedencia. En ruta incluir región, paradas, perfil, escenario, restricciones, geometría densa y visual, recursos, alertas y causas de rechazo.
- Unificar validaciones en backend y mostrar el resultado en la interfaz. Si no hay servidor o datos suficientes, informar explícitamente la capacidad disponible.
- Validación: contratos serializan y rechazan región desconocida, coordenadas inválidas, capas ausentes y escenarios incompatibles. El resultado visual coincide con el backend. No cambiar automáticamente de astronauta a rover.

## 2. Datos y geografía regional

- Crear un manifiesto por región con extensión, CRS/datum, forma, resolución efectiva, máscaras, fuente, fecha y estado observado/derivado/simulado/no disponible. Validar alineación geográfica, nodata y unidades; eliminar el uso silencioso de capas Gale en Jezero.
- Auditar el DEM Jezero local de valores constantes y la procedencia de las capas visuales separadas; obtener o preparar datos válidos antes de habilitar planificación regional. No presentar imágenes THEMIS en DN como temperatura física.
- Catalogar relieve, óptica, información espectral y ambiente según cobertura real. La malla de 44 m no añade detalles a un DEM de resolución más gruesa. Mantener objetivos, MDA y refugios ficticios identificados.
- Validación: pruebas de bordes, centros de celda, ausencia de datos y alineación; referencias conocidas por región; ninguna solicitud Jezero lee matrices de Gale. Cuando falte una capa se indica y se explica el efecto sobre la ruta.

## 3. Planificador y recursos de EVA

- Rechazar coordenadas fuera de cobertura y puntos bloqueados; si se propone un ajuste, mostrar distancia y pedir aceptación en el flujo. Incorporar máscara de validez y definir política de diagonales. Evaluar distancia, pendiente y recursos sobre ruta densa; simplificar solo para visualización y comprobar los segmentos.
- Separar restricciones duras y costos; cargar y aplicar las reservas y límites acordados de tiempo, oxígeno, energía y exposición. Los valores son de demostración hasta su revisión experta. No afirmar que no existe solución factible cuando solo se evaluó una candidata.
- Verificar A* frente a Dijkstra en grillas pequeñas; escalar heurística si el costo mínimo es inferior a uno. Hacer que los nombres de perfiles correspondan a su función real; asegurar que el perfil científico tenga datos apropiados antes de prometer optimización científica.
- Integrar Pandolf adaptado como modelo experimental opcional por segmento: parámetros versionados, pendiente con signo, tiempo, gasto y oxígeno. Compararlo con el modelo actual y analizar sensibilidad; no aplicar recursos de EVA a rovers robóticos.
- Validación: obstáculos, esquinas, rutas sin solución, límites exactos, reserva insuficiente, pendientes ascendentes/descendentes, distancia densa y unidades. Un resultado inválido nunca se acepta como ruta válida en la interfaz.

## 4. Simulación ambiental y replanificación

- Definir escenarios deterministas por región, semilla, sol, intervalo, cobertura y versión. Empezar por viento y polvo; añadir radiación, temperatura y estabilidad del suelo como capas simuladas o derivadas con unidades, incertidumbre y fuente. Un dato puntual del rover no representa automáticamente toda la región.
- Asociar evento a zona, hora y efecto explícito sobre costos o bloqueos. Recalcular desde posición y recursos actuales; mostrar ruta anterior y nueva, diferencias y motivos. Si falla, conservar estado y comunicar la causa, sin anunciar éxito.
- Evaluar campo inverso a refugios bajo supuestos fijos y reservar oxígeno para emergencia; invalidarlo al cambiar región, obstáculos, refugios, parámetros o escenario. El balance térmico y barrido horario del artifact requieren datos adecuados y un algoritmo temporal contrastado antes de prometer optimalidad.
- Validación: misma semilla produce mismos eventos; una zona bloqueada cambia ruta o provoca rechazo; evento fuera del recorrido no causa desvío espurio; retorno respeta dirección, reservas y estado. Probar falta de ruta y replanificación repetida.

## 5. Fuentes de rover y comparación

- Los rovers son productores de datos, no vehículos presurizados para personas. Identificar trayectoria, misión, sol, fecha de descarga, cobertura y licencia. Separar la última posición publicada de telemetría en directo; verificar en navegador las vistas NASA existentes, fallo de red y enlace externo. La vista actual no alimenta el planificador ni guarda posición offline.
- Preparar comparaciones de tramos reales Curiosity/Gale y Perseverance/Jezero con puntos de inicio y final comparables, CRS y versiones trazables. Adaptar el script de referencia para consumir rutas GaleX y rotular sus datos sintéticos correctamente.
- Validación: métricas de distancia en ambos sentidos, cobertura de corredor y razón de longitudes; probar tramos vacíos y fuera de cobertura. Interpretar divergencia según objetivos y resolución. Coincidir con un rover no valida seguridad humana.

## 6. Interfaz, persistencia y operación

- Integrar capas, procedencia, reloj, alternativas, recursos, eventos y alertas en vistas existentes. Priorizar lectura, unidades, accesibilidad y flujo de astronauta. Permitir consulta científica y registros persistentes; distinguir posición simulada del explorador y posición publicada de rovers.
- Probar con internet desactivado y servidor local activo, con caché vacía/poblada, reinicios y errores de escritura. Identificar funciones que requieren red o servidor. Completar traducción ES/EN donde se requiera; evitar afirmar persistencia si el guardado falla.
- Validación: recorrido completo en Gale y Jezero con datos disponibles, reporte tras reinicio, navegación 2D/3D, tamaños de pantalla representativos, teclado y estado sin conexión. Comprobar mapas NASA integrados en navegador y alternativa externa.

## 7. Rendimiento y mantenimiento

- Tras medir, considerar caché de superficies y resultados indexada por región, datos, perfil y escenario; ejecución no bloqueante, límites de concurrencia y cancelación de solicitudes obsoletas. Medir primer cálculo y repetidos, memoria y latencia percentil 95 en equipo acordado.
- Verificar invalidación ante cambios de datos y que las respuestas antiguas no sustituyan rutas nuevas. Definir metas numéricas después de medir y acordar hardware; no asumir que reducir resolución conserva seguridad.
- Determinar fuente canónica de documentos antes de deduplicar. Conservar copias divergentes, teselas versionadas, modelos de referencia y datos persistentes hasta verificar usos y migración. Corregir README y textos de interfaz cuando el comportamiento correspondiente esté verificado.

## Dependencias y decisiones pendientes

Orden: contratos y medición → datos regionales → rutas y restricciones → simulación/replanificación → comparación de rovers e interfaz → optimización basada en mediciones. Los trabajos de catálogo y pruebas pueden avanzar junto a los contratos. No hay estimaciones fiables de duración todavía.

Decidir con el equipo: parámetros demostrativos y reservas de EVA; orden de objetivos y tolerancia de ajuste de puntos; equipo objetivo y tiempos deseables; prioridad relativa de variables ambientales; si basta servidor local o se requiere contenedor de escritorio; y el alcance de datos disponibles offline. Hasta decidirlos, usar escenarios explícitamente hipotéticos y no inventar criterios de aceptación científicos.
