# Registro de implementación y validaciones

## Precisión de recursos EVA

`MR.consumeEvaResources` calcula consumo por minutos con las tasas demostrativas del servidor, incluyendo mayor consumo de oxígeno en pendientes ascendentes y descanso sin pendiente. La simulación mantiene ese balance durante la marcha y descansos de una hora, y se pausa al agotar oxígeno, batería o las ocho horas nominales. El salto nocturno queda deshabilitado mientras no se compruebe refugio y reposición. `tests/test_eva_estimates.cjs` comprueba la función y el agotamiento; falta validar el flujo completo en navegador y evitar divergencias entre constantes de cliente y servidor. El balance aún no alimenta la API de replanificación ni constituye una validación científica.

Las estimaciones locales de duración y recursos usan por defecto la caminata EVA; antes algunas llamadas sin modo explícito utilizaban velocidad de rover. `tests/test_eva_estimates.cjs` verifica el comportamiento predeterminado. Estas estimaciones locales siguen siendo provisionales y difieren del cálculo del servidor.

El cálculo de recursos admite un estado inicial explícito y acumula consumo, tiempo y dosis sobre él; valida reservas y exposición iniciales. El planificador puede usar ese estado al evaluar una o varias alternativas. La API acepta opcionalmente `initial_resources` con los cuatro campos numéricos obligatorios `oxygen_pct`, `battery_pct`, `eva_time_min` y `radiation_dose_msv`; omitirlo conserva el comportamiento de una EVA nueva. `tests/test_eva_resources.py` compara una ruta completa con dos tramos sucesivos; las pruebas del planificador y la API comprueban reservas insuficientes y entradas inválidas. La simulación todavía no mantiene ni suministra ese estado para replanificar, y la API no verifica su procedencia.

La alerta de tormenta identifica sus valores como escenario hipotético y ya no anuncia una replanificación inexistente ni registra un reporte que la afirme. El usuario puede dejar la simulación en pausa o continuar por la ruta anterior, que no incorpora la tormenta. La replanificación requiere todavía un balance acumulado de recursos y una evaluación ambiental coherente; este flujo no se ha probado visualmente en navegador.

Al aceptar una ruta se copian sus puntos y distancias del servidor sin recalcularlos en el cliente. La aprobación rechaza puntos incompletos, valores no finitos y distancias acumuladas decrecientes. `tests/test_route_validation.cjs` verifica la copia y el rechazo. Los cambios de ruta locales durante la marcha están deshabilitados hasta que exista validación integral del recorrido restante; la simulación se pausa y las misiones secundarias permanecen propuestas. La alerta permite continuar por la ruta anterior bajo decisión del usuario o abortar. Falta verificar estos flujos en navegador.

La comprobación del refugio utiliza el centro de la celda final realmente devuelto por A*, en lugar de la coordenada solicitada. `tests/test_planner_safety.py` cubre el caso en que el ajuste de grilla sitúa ese punto fuera del radio permitido. La respuesta incluye coordenadas solicitadas, centros de celda y distancias de ajuste; el panel muestra las distancias antes de aceptar la ruta. No se ha comprobado visualmente este flujo en navegador.

Las restricciones de oxígeno, batería, tiempo y radiación se evalúan con los valores de recursos sin redondear. Se eliminó del cálculo EVA el modelo heredado de rover presurizado; solo admite astronautas. `tests/test_eva_resources.py` comprueba una reserva de 24,96 % frente al umbral del 25 % y el rechazo del modelo de rover. La ruta densa conserva la precisión de distancia, elevación y transitabilidad para calcular esos recursos; `tests/test_planner_safety.py` verifica esa precisión. Los parámetros siguen siendo demostrativos, no validados científicamente.

## Persistencia de reportes sin conexión

El servidor valida autor, coordenadas y formato de adjuntos antes de guardar un reporte; los datos inválidos reciben un error de entrada en vez de provocar un fallo de integridad de SQLite. `tests/test_report_validation.py` cubre estos casos y coordenadas cero.

La conexión con el servidor se comprueba cada 30 segundos, además del evento de reconexión del navegador. Esto permite reintentar reportes cuando vuelve el backend aunque la red del dispositivo no haya cambiado; las comprobaciones simultáneas se consolidan.

Los reportes con ID se conservan en localStorage antes del envío y se recuperan al iniciar la aplicación. Se reintentan al reconectar; la entrada se elimina tras confirmación del servidor. El endpoint de reportes usa reemplazo por ID, por lo que un reintento no duplica el reporte. Los fallos de almacenamiento se comunican al registrar un hallazgo. Se retiró el aviso de envío a Tierra y el deshacer exclusivamente visual que no eliminaba el registro persistido. Esta cola cubre reportes; mensajes, misiones y telemetría todavía requieren persistencia e idempotencia propias.

`tests/test_report_queue.cjs` verifica recarga, fallo de red, reintento concurrente y agotamiento de almacenamiento. No sustituye la comprobación en navegador ni garantiza sincronización entre múltiples pestañas.

## Cambios implementados

- Validación de solicitudes: región soportada, forma de paradas, coordenadas finitas dentro de cobertura y perfil conocido.
- Cliente: identifica región; evita aplicar respuestas rechazadas, de otra región o de solicitudes anteriores.
- Planificador: incorpora máscara de validez y DEM no finito; evita cruzar esquinas bloqueadas; escala la heurística por costo mínimo; conserva ruta densa para recursos; deja de desplazar paradas bloqueadas automáticamente.
- EVA: elimina selección automática de rover por distancia; aplica reservas de oxígeno/batería por perfil y límites de duración y dosis configurados. Los valores siguen siendo demostrativos.

## Cobertura y límites

Las pruebas automatizadas cubren configuración, serialización de dominio, persistencia SQLite, estructura del escenario, cálculo de alternativas y rechazos, solicitudes inválidas, nodata, diagonales bloqueadas, costos inferiores a uno y una EVA corta con reservas.

No se ha validado visualmente la aplicación ni la integración de mapas NASA en navegador. Se retiró el selector de rover presurizado; las nuevas misiones usan astronauta. La aceptación de ruta exige aprobación del backend ligada a geometría, región y perfil. El cliente conserva la geometría densa y muestra recursos del servidor para la ruta aprobada; el cálculo local restante se rotula provisional. Existen funciones heredadas de rover y cálculos locales durante el recorrido que aún requieren consolidación. La integración de viento/polvo con las restricciones, la replanificación efectiva, la invalidación de cachés, las sesiones prolongadas y el cálculo en Jezero permanecen pendientes. La aprobación de pruebas no implica cumplimiento de esas funciones ni validación científica.

Pruebas adicionales del cliente: `node --test tests/test_route_validation.cjs` comprueba que resultados rechazados o incompletos no aprueben una ruta y que una aprobación no se transfiera a otra geometría, región o perfil. La sintaxis de `app.js` y la revisión `git diff --check` pasan. Queda pendiente comprobar el flujo completo en navegador.
