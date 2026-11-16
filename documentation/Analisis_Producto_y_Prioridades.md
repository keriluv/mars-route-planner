# Análisis del producto y prioridades de mejora

Fecha: 15 de noviembre de 2026. Evaluación del repositorio local; no incluye procedimientos de entrega. Los planes describen objetivos, no prueban por sí solos que estén implementados. El enlace de Claude no fue accesible, pero posteriormente se analizó la copia HTML local; véase [Contexto integral y evaluación del artifact](Contexto_Integral_y_Artifact.md).

## Producto actual

GaleX es un prototipo web servido localmente, con vista 2D y dos vistas 3D, datos de Gale, recursos de Jezero, reproducción simulada y persistencia local. La aplicación usa JavaScript en `web/`, un servidor Python en `backend/`, lógica geoespacial y de planificación en `src/marsroute/`, y datos/modelos precalculados. No es un sistema validado para decisiones EVA. Las estaciones MDA y los refugios del escenario deben identificarse como hipotéticos; los datos históricos no son condiciones actuales de Marte. La documentación de Fase 0 es un registro anterior y sus resultados no sustituyen pruebas del estado actual.

## Hallazgos prioritarios

1. **Resultados de ruta inconsistentes.** `backend/server.py:140` carga exclusivamente datos y refugios de Gale; no recibe ni aplica una región. `web/js/core.js:194` calcula recursos y validez con fórmulas diferentes a `src/marsroute/multicriteria.py:74`. La interfaz solicita refinamiento y utiliza `res.route` sin comprobar `is_valid` (`web/js/app.js:937`). Acordar un contrato regional y una fuente de verdad para ruta, recursos, movilidad, alertas y rechazo; la interfaz debe mostrar el resultado y sus límites sin sustituirlos por otro cálculo. Probar Gale y Jezero con entradas válidas, fuera de región y sin ruta.
2. **Restricciones declaradas no garantizadas.** `config/route_profiles.yaml` declara reservas, duración, radiación y límites ambientales; el planificador carga solo parte de los perfiles y rechaza por oxígeno o batería agotados, no por las reservas configuradas. Tampoco aplica todos los límites ambientales y de radiación. La selección automática de rover para recorridos largos cambia la movilidad solicitada implícitamente. Definir valores demostrativos y aplicar explícitamente las restricciones, sin atribuirles validación médica; conservar causas de rechazo y permitir elección expresa de movilidad.
3. **La replanificación meteorológica es principalmente una puesta en escena.** El botón en `web/js/app.js:263` cambia el perfil y muestra éxito, pero ese bloque no calcula una nueva ruta ni transmite una zona bloqueada. Conectar evento simulado, zona afectada y cálculo real, y mostrar éxito solo tras verificar el resultado; mantener la ruta previa y explicar fallos.
4. **Geometría y datos de ruta.** `multicriteria.py` ajusta puntos bloqueados a celdas cercanas y recorta coordenadas al borde sin informar al usuario. Simplifica antes de evaluar distancia y recursos; es necesario verificar que cada segmento simplificado respete el corredor y que los cálculos se hagan sobre el trayecto denso. La máscara de validez tampoco se incorpora en `build_cost_surface`. Validar coordenadas, comunicar desplazamientos, bloquear datos ausentes y probar obstáculos, diagonales y extremos.
5. **Repetibilidad y rendimiento.** El planificador cachea datos cargados en memoria, pero realiza A* por tramo y perfil; la documentación histórica informa una medición de unos 13 s para un caso, no un benchmark actual. Medir arranque en frío/caliente, tiempos por perfil, memoria y solicitudes repetidas antes de escoger optimizaciones. Evaluar reutilizar superficies de costo, limitar concurrencia y mover trabajo pesado fuera del hilo de atención; verificar que cachés cambien al cambiar datos, región o configuración. No prometer mejoras porcentuales sin mediciones.
6. **Persistencia y offline.** Hay SQLite/JSONL y recursos locales, pero la caché de Mars Trek solo cubre teselas ya descargadas; ausencia de red y ausencia del servidor son escenarios distintos. Probar arranque y flujos con red desactivada, caché vacía y poblada, reinicio y fallos de escritura; identificar capas no disponibles y persistencia no confirmada. Un service worker no reemplaza al servidor Python para calcular rutas o escribir SQLite.
7. **Procedencia y comunicación.** Catálogos, UI y backend deben compartir fuente, fecha/sol, unidad, resolución efectiva, región, estado observado/derivado/simulado y ausencia de datos. El texto «refugio presurizado verificado» en `web/js/core.js` puede confundirse con infraestructura real. Diferenciar UV y dosis ionizante y no presentar similitud con recorrido de rover como probabilidad de seguridad humana.
8. **Pruebas de comportamiento.** `tests/test_smoke.py` ya existe: la afirmación histórica de ausencia total de pruebas está desactualizada. Ampliar pruebas con casos de rechazo, límites de región, consistencia interfaz/API, eventos, persistencia tras reinicio y escenarios offline; incorporar mediciones de rendimiento y una prueba del flujo visual 2D/3D. Evitar priorizar efectos gráficos sobre la corrección funcional.

## Modelos de referencia

- `suggestion models/simulador_marte.py` ofrece ideas para coste por segmento, pendiente con signo, oxígeno, barrido de horarios y reserva hacia refugios. Su Pandolf adaptado a gravedad marciana, velocidad, calor, radiación y pulso contienen supuestos; no son una validación fisiológica o EVA. Integrar primero como modelo experimental configurable, con unidades, procedencia, límites de aplicación y comparación con el modelo existente; no incorporar pulso o balance térmico como mediciones. Gy y Sv no son unidades intercambiables sin un modelo adecuado.
- `suggestion models/validacion_perseverance.py` propone comparar distancia al corredor y longitud. Por defecto usa terreno y recorrido sintéticos, aunque imprime «recorrido real»; no demuestra validación con Perseverance. Debe consumir la ruta del producto y un recorrido real trazable en el mismo CRS, región y tramo temporal, comprobar cobertura y usar métricas simétricas; acordar criterios de aceptación. Coincidir con un rover no valida seguridad humana ni demuestra que su recorrido fue óptimo.
- `suggestion models/visor.html` sirve como referencia visual de reproducción y métricas; depende de CDN y de un formato de salida propio. Adaptar conceptos a la interfaz y contratos existentes, sin agregar un segundo visor operativo ni comprometer el modo offline.

## Orden de trabajo propuesto

1. Establecer casos reproducibles y medir la línea base, con pruebas que expongan divergencias y fallos.
2. Unificar región, movilidad, rutas y validación; aplicar límites y corregir el flujo de rechazo antes de ampliar capacidades.
3. Hacer reproducible la simulación de eventos y la replanificación, con procedencia y persistencia verificables.
4. Incorporar el modelo metabólico experimental por segmentos y después la comparación de recorridos reales, con supuestos y datos acordados.
5. Optimizar los cuellos de botella medidos y mejorar las vistas según las necesidades de uso.

## Decisiones abiertas

- ¿Qué límites demostrativos y reservas se deben utilizar para astronauta y para rover, y quién los define? La ecuación de Pandolf adaptada debe tratarse como estimación experimental.
- Confirmado por el usuario: Curiosity y Perseverance son fuentes de trayectorias y datos; GaleX debe generar y simular rutas propias para la EVA con evidencia de los rovers y escenarios ambientales. Los rovers no son presurizados para personas.
- ¿El producto se ejecutará como aplicación web con servidor local o necesita además una aplicación de escritorio independiente? ¿Qué funciones deben operar sin internet y cuáles sin servidor?
- ¿Qué significa «ejecuciones constantes»: rapidez de arranque, simulaciones largas, peticiones simultáneas, replanificaciones frecuentes o todas? Definir equipo objetivo y tiempos aceptables.
- ¿El orden de objetivos debe respetar la selección o calcularse por proximidad/optimización? ¿Es admisible mover un punto bloqueado y con qué tolerancia?
- ¿Qué fuentes y criterios se usarán para comparar recorridos de Curiosity y Perseverance? El resultado será una comparación, no una certificación de seguridad.

## Organización y limpieza

Los documentos de Fase 0, plan técnico y PDF existen en raíz y `documentation/` con contenido idéntico; los dos planes por fases ya difieren y el de raíz contiene prioridades añadidas sin registrar. Definir una única fuente canónica y actualizar referencias antes de eliminar copias. `3dView/dem_tiles/` ocupa aproximadamente 560 MB y contiene archivos versionados; no se presupone que sean prescindibles. `backend/data` contiene estado persistente, por lo que no debe borrarse como caché. Los modelos de referencia están sin seguimiento y se conservan. No se eliminó código ni información sin comprobar dependencias y finalidad.
