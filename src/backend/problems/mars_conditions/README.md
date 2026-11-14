# Problema: análisis de condiciones marcianas

Analiza observaciones meteorológicas REMS de los soles 100 y 4500 y las capas superficiales procesadas de Gale Crater.

- `rems.py`: parser de los datos tabulares originales de REMS.
- `analysis.py`: estadísticas, perfiles horarios y distribuciones de las capas raster.
- `main_statics.py`: página local independiente del visor de rutas.

Desde la raíz del proyecto, ejecuta:

```powershell
python src\backend\problems\mars_conditions\main_statics.py
```

Abre la página en el navegador y guarda `outputs/conditions_summary.json` y `outputs/mars_conditions_dashboard.html`. Requiere `data/processed/layers.npz`, `layers_meta.json` y los dos CSV REMS procesados. Si falta el mosaico de capas, ejecuta `python scripts\build_layers.py`; para preparar REMS, ejecuta `python scripts\prepare_rems.py`.

La comparación meteorológica cubre solo dos soles y no representa climatología estacional. THEMIS se presenta en DN (valor de imagen), no como temperatura calibrada; la grilla superficial es de aproximadamente 44 m.
