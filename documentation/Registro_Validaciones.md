# Registro de implementación y validaciones

## Precisión de recursos EVA

`MR.consumeEvaResources` calcula consumo por minutos con las tasas demostrativas del servidor, incluyendo mayor consumo de oxígeno en pendientes ascendentes y descanso sin pendiente. La simulación mantiene ese balance durante la marcha y descansos de una hora, y se pausa al agotar oxígeno, batería o las ocho horas nominales. El salto nocturno queda deshabilitado mientras no se compruebe refugio y reposición. `tests/test_eva_estimates.cjs` comprueba la función y el agotamiento; falta validar el flujo completo en navegador y evitar divergencias entre constantes de cliente y servidor. El balance aún no alimenta la API de replanificación ni constituye una validación científica.

Durante la marcha, el panel de recursos muestra el balance acumulado y advierte que no se ha reevaluado la ruta restante con ese estado ni con el clima; antes de partir continúa mostrando la estimación de la ruta. La actualización visual aún no se ha probado en navegador.

Los controles de inicio, etapa y alertas comparten la comprobación de recursos y horario antes de reanudar. La tarjeta nocturna no promete una reanudación automática. `tests/test_eva_estimates.cjs` cubre estados agotados, ausentes e inválidos y el límite horario; queda pendiente la prueba de interacción completa en navegador.

El descanso de una hora se valida antes de avanzar el tiempo: se rechaza si agotaría recursos, llegaría al límite temporal EVA o alcanzaría el horario nocturno. Cada paso de marcha se recorta en el primer límite de recursos, horario o destino; ya no se declara llegada hasta alcanzar el final. Las pruebas unitarias cubren esos límites, pero el flujo integrado aún no se ha verificado en navegador.

`tests/test_eva_model_consistency.py` compara el consumo de cliente y servidor para una hora en terreno llano y en ascenso, y verifica el límite temporal configurado. Las tasas siguen duplicadas, pero las pruebas detectan divergencias en esos escenarios; el cliente se pausa al alcanzar el límite, mientras el servidor rechaza si se supera.

Las estimaciones locales de duración y recursos usan por defecto la caminata EVA; antes algunas llamadas sin modo explícito utilizaban velocidad de rover. `tests/test_eva_estimates.cjs` verifica el comportamiento predeterminado. Estas estimaciones locales siguen siendo provisionales y difieren del cálculo del servidor.

El cálculo de recursos admite un estado inicial explícito y acumula consumo, tiempo y dosis sobre él; valida reservas y exposición iniciales. El planificador puede usar ese estado al evaluar una o varias alternativas. La API acepta opcionalmente `initial_resources` con los cuatro campos numéricos obligatorios `oxygen_pct`, `battery_pct`, `eva_time_min` y `radiation_dose_msv`; omitirlo conserva el comportamiento de una EVA nueva. `tests/test_eva_resources.py` compara una ruta completa con dos tramos sucesivos; las pruebas del planificador y la API comprueban reservas insuficientes y entradas inválidas. La simulación mantiene un balance local, pero todavía no lo suministra para replanificar; la API no verifica su procedencia.

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

## Etapa 4: Replanificación real, Modelo Pandolf y Validación contra Rovers (15 de Noviembre de 2026)

Se completaron las 4 fases de alta prioridad acordadas en el plan de trabajo:

1. **Replanificación real con recursos acumulados (Fase 1 - Commit `1eaacb3`):**
   - `web/js/api.js`: Se actualizó `API.route` para enviar opcionalmente el objeto `initial_resources` (`oxygen_pct`, `battery_pct`, `eva_time_min`, `radiation_dose_msv`).
   - `web/js/app.js`: Implementación de la función `replanEvaRoute(triggerReason)`. Al activarse una alerta meteorológica de tormenta o desvío por pendiente crítica, el usuario puede solicitar replanificación hacia el refugio evaluando el estado acumulado de recursos. Si el planificador devuelve una ruta válida, se muestra un diálogo modal comparativo (distancia restante, tiempo estimado, O₂ final, batería y destino) que requiere aprobación explícita del usuario antes de coser el tramo caminado con la nueva ruta. En caso de rechazo, se conserva la ruta previa en pausa y se exponen las causas de seguridad.
   - Nueva prueba unitaria: `tests/test_replan_eva.cjs`.

2. **Modelo metabólico de Pandolf adaptado a Marte (Fase 2 - Commit `a691de4`):**
   - `src/marsroute/multicriteria.py`: Incorporación de la ecuación de Pandolf adaptada a gravedad marciana ($g = 0.378$, $W = 75\text{ kg}$, $L = 60\text{ kg}$, $\eta = 1.5$, $F_{\text{traje}} = 1.1$).
   - `web/js/core.js`: Sincronización exacta en JavaScript de `MR.pandolfPower`, `MR.heartRate` y `MR.consumeEvaResources`, garantizando paridad matemática cliente-servidor (comprobada en `tests/test_eva_model_consistency.py`).
   - Contabilidad física: Capacidad útil de tanque $650\text{ g}$ de O₂ ($20,100\text{ J/L}$, $1.429\text{ g/L}$), gasto energético en vatios y calorías ($kcal$), frecuencia cardíaca estimada ($lpm$) y consumo de agua ($L$).
   - `backend/server.py`: `parse_initial_resources` ampliado para aceptar los nuevos campos fisiológicos opcionales sin romper validaciones estrictas.

3. **Módulo de validación cuantitativa contra rovers reales (Fase 3 - Commit `497be42`):**
   - `src/marsroute/evaluate_rovers.py`: Algoritmo de comparación espacial entre rutas predictivas y recorridos reales de Curiosity (Cráter Gale, 19,188 puntos) y Perseverance (Cráter Jezero).
   - Métricas: Remuestreo equiespaciado cada $20\text{ m}$, distancias ortogonales mínimas (desviación media, máxima y desviación estándar), porcentaje dentro de corredores de seguridad ($50\text{ m}$, $100\text{ m}$, $200\text{ m}$) y razón de longitud.
   - Generación de informe auditable en `outputs/validacion_rovers.json`.
   - Nuevas pruebas unitarias: `tests/test_rover_validation.py`.

4. **Telemetría metabólica del traje y balance en vivo (Fase 4 - Commit `cad734e`):**
   - `web/index.html` y `web/css/app.css`: Integración del componente `.suit-hud` en el dock inferior de caminata, mostrando pulso ($lpm$), potencia metabólica ($W$), calorías quemadas ($kcal$), oxígeno útil en tanque ($g$ y $\%$), agua ($L$) y radiación acumulada ($mSv$).
   - `web/js/app.js`: Nueva pestaña "Soporte Vital y Traje" en el modal de Condiciones (`openDashboard`), con desglose de la ecuación biomecánica de Pandolf, tabla de esfuerzo por pendiente y balance térmico.

### Resumen de validación actual
- **Python test suite:** 54 pruebas pasadas exitosamente (`pytest -q` en 97.24 s).
- **Node.js test suite:** 16 pruebas pasadas exitosamente (`node --test tests/*.cjs` en 148 ms).
- **Formato y calidad git:** `git diff --check` limpio sin errores de espaciado.

## Alertas y ventanas emergentes durante la simulación de recorrido (Noviembre 2026)

Se implementaron alertas progresivas y ventanas emergentes reactivas conforme transcurre la caminata EVA, monitoreando el estado metabólico, los consumibles de soporte vital y las condiciones ambientales:

1. **Alerta preventiva de Oxígeno (≤ 35%):**
   - Banner de advertencia en pantalla que notifica a la tripulación el consumo acumulado de O₂ en gramos y el porcentaje restante en el tanque PLSS.
2. **Alerta crítica emergente de Reserva de Oxígeno (≤ 25%):**
   - Ventana modal emergente con pausa automática de la simulación. Expone los hechos de soporte vital (O₂ remanente, gramos consumidos, potencia metabólica Pandolf en W y distancia a meta).
   - Opciones operativas: abortar marcha hacia base, continuar bajo propio riesgo con precaución, o solicitar replanificación hacia refugio (`replanEvaRoute`).
3. **Aviso de hidratación y deshidratación acumulada (≥ 1.0 L transpirado):**
   - Banner de advertencia fisiológica que alerta de la pérdida de fluidos y sugiere activación de la toma de agua del casco y reposición de sales electrolíticas.
4. **Aviso de batería PLSS baja (≤ 25%):**
   - Banner de aviso para limitar el uso de telemetría secundaria y calefacción auxiliar no esencial.
5. **Estrés térmico e integridad del traje por frío ambiental (< -65 °C o sensación térmica):**
   - Alerta reactiva cuando la temperatura de la atmósfera desciende de forma severa, recomendando máxima calefacción en botas y guantes.
6. **Presión barométrica baja en cotas altas (< 680 Pa):**
   - Alerta informativa en ascensos a cotas elevadas advirtiendo del mayor diferencial de presión en sellos del traje EVA.
7. **Pruebas unitarias:**
   - Incorporación de `tests/test_eva_alerts.cjs` con 3 pruebas específicas que validan la transición de umbrales de O₂ (35% y 25%), acumulación hídrica (> 1.0 L) y descarga lineal de batería. Total de pruebas Node.js aumentado a 16.
