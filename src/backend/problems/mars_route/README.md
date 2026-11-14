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

Ejecuta `python src\backend\problems\mars_route\main.py` para abrir el visor interactivo local. También puedes usar el lanzador `python scripts\main_plan_route.py`. En el mapa pulsa “Elegir inicio” o “Elegir destino”, haz clic dentro del rectángulo amarillo y luego pulsa “Calcular ruta”. El servidor local calcula la ruta con las matrices de costo precalculadas y guarda el resultado en `outputs/simulated_route.json`. Deja abierta la terminal mientras usas el visor; `Ctrl+C` lo detiene. Los puntos deben estar dentro del área de estudio definida en `config/mission.yaml` y en terreno transitable.

El visor usa `data/raw/gale_context.jpg` como mapa base (contexto regional del conjunto del proyecto; fuentes de capas descritas en el README principal).

Los datos atmosféricos REMS están organizados aparte en `backend/problems/mars_environment/`, porque no participan en el cálculo de rutas. Los insumos y artefactos permanecen fuera de `src/`: `data/`, `models/`, `outputs/` y `config/`.
