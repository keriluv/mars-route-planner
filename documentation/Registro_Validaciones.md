# Registro de implementación y validaciones

## Precisión de recursos EVA

Las restricciones de oxígeno, batería, tiempo y radiación se evalúan con los valores de recursos sin redondear. Se eliminó del cálculo EVA el modelo heredado de rover presurizado; solo admite astronautas. `tests/test_eva_resources.py` comprueba una reserva de 24,96 % frente al umbral del 25 % y el rechazo del modelo de rover. Las distancias de los puntos aún se cuantizan a metros, y los parámetros siguen siendo demostrativos, no validados científicamente.

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
