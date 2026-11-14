# Problema: planificación de rutas en Marte

Este paquete contiene la lógica reutilizable del backend para planificar rutas en Gale Crater.

- `main.py`: visor interactivo local; permite marcar inicio y destino en el mapa y calcular una ruta nueva.
- `layers.py`: geometría de la grilla y carga/construcción de capas raster.
- `model.py`: entrenamiento, persistencia y predicción de transitabilidad.
- `planner.py`: superficie de costo, búsqueda A* y conversión de ruta.
- `evaluate.py`: métricas y evaluación de rutas.
- `visualize.py`: generación de mapas y visualizaciones para análisis.

Los scripts de `scripts/` siguen siendo los puntos de entrada del flujo de datos. Una futura API puede importar estas funciones desde `backend.problems.mars_route` y devolver JSON al frontend; no se añadieron endpoints todavía porque el proyecto no tiene framework/API configurado.

Para calcular la ruta base y preparar las capas necesarias:

```powershell
python scripts\plan_route.py
```

Ejecuta `python src\backend\problems\mars_route\main.py` para abrir el visor interactivo local. También puedes usar el lanzador `python scripts\main_plan_route.py`. En el mapa pulsa “Elegir inicio” o “Elegir destino”, haz clic dentro del rectángulo amarillo y luego pulsa “Calcular ruta”. El servidor local calcula la ruta con las matrices de costo precalculadas, la divide en tramos de esfuerzo y guarda el resultado en `outputs/simulated_route.json`. Deja abierta la terminal mientras usas el visor; `Ctrl+C` lo detiene. Los puntos deben estar dentro del área de estudio definida en `config/mission.yaml` y en terreno transitable.

El tiempo estimado usa `simulation.base_speed_kmh` como velocidad base y ajusta la velocidad por pendiente, rugosidad y transitabilidad. Los tramos se cierran aproximadamente cada `simulation.target_segment_hours` horas de esfuerzo, por eso sus distancias varían. Cada nivel fácil/medio/difícil muestra las métricas que más contribuyeron a su clasificación.

`oxygen.max_exploration_hours` define el presupuesto de tiempo por salida (2.5 h), `oxygen.hard_limit_hours` el máximo configurado para el prototipo (3 h) y `oxygen.contingency_reserve_hours` la diferencia reservada (0.5 h). El tiempo de ida y vuelta se aproxima como dos veces la ida por la misma ruta. Si excede 2.5 h, el visor avisa que no cabe en una salida, pero todavía no busca una ruta alternativa optimizada por tiempo ni valida refugios, recarga o consumo fisiológico real de oxígeno.

El visor usa `data/raw/gale_context.jpg` como mapa base (contexto regional del conjunto del proyecto; fuentes de capas descritas en el README principal).

El análisis meteorológico y superficial está organizado aparte en `backend/problems/mars_conditions/`, porque no participa en la búsqueda de rutas. Los insumos y artefactos permanecen fuera de `src/`: `data/`, `models/`, `outputs/` y `config/`.
