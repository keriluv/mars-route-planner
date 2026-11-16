# Cada paso importa — revisión dinámica

16 de noviembre de 2026. Solicitud: mantener toda la cobertura de funciones, mover realmente mapas y vistas 3D, transiciones suaves y un contenido nuevo al menos cada diez segundos.

- Duración: 119,8 s, 1920 × 1080, 30 fps; 17 escenas de producto y cierre de marca de 5 s.
- Ritmo: escenas de 6–8 s, solapadas 0,6 s; una función nueva cada 5,4–7,4 s. La ampliación frente a los 76 s iniciales permite cubrir las áreas que faltaban sin amontonar la información.
- Imagen: producto a pantalla completa. Se retiran las imágenes fijas superpuestas de planificación, EVA y relieve. Las grabaciones incluyen navegación, giros, acercamientos, cambios de capas y acciones reales.
- Tipografía: titulares Inter 700 de 64 px, contexto Inter 400 de 30 px. Cartela inicial de cada escena durante 3,8 s, seguida de una vista despejada de la acción. Negro #080808, blanco y rojo #fc3d21.
- Movimiento: giros reales del visor, navegación y zoom de la aplicación; acercamientos editoriales entre 1 y 1,25. Transiciones de cortina horizontal, cortina vertical e iris circular, de 0,6 s con power3.inOut. El cierre conserva el logo original y su pequeño destello.
- Sonido: se mantiene la revisión sin música elegida por el usuario. No se añade voz.

`coverage.json` registra inicio, duración y funciones de cada escena. `build_dynamic.py` es el generador de esta revisión. `build_scenes.py` conserva el montaje V1 y no debe ejecutarse sobre V2 sin guardar primero los cambios.

## Cobertura

1. Planeta 3D: giro y vuelo hacia Gale.
2. Relieve 3D: órbita y profundidad.
3. Mapa 2D: desplazamiento, zoom y mapas base.
4. Capas: terreno, curvas, pendiente y térmico relativo.
5. Regiones: Gale y Jezero en navegación.
6. Minerales: búsqueda y fichas con instrumentos.
7. Objetivos: referencias y filtros.
8. Rutas: perfiles, cálculo y resultado.
9. EVA: avance, perfil de elevación, reloj y recursos.
10. Condiciones: atmósfera, terreno y modelo.
11. Traje: fisiología experimental y recursos.
12. Ambiente: tormenta hipotética, alerta y pausa.
13. Misiones: principal y secundarias.
14. Hallazgos: notas y registro local pendiente.
15. Bitácora: comunicaciones simuladas y asistente.
16. Rovers: comparación local Curiosity/Perseverance. No se reproduce el mapa externo que devolvió 404.
17. Controles: tema, idioma, tripulación, velocidad, movimiento reducido y ayuda.
18. Marca: animación breve del logo y frase final.

No se afirma validación operacional de las cifras, de las comparaciones ni de los modelos fisiológicos. No se anuncia éxito de una acción que no se muestre. La captura usa un escenario de demostración y bloquea escrituras al servidor salvo el cálculo de ruta.
