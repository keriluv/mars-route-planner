# Revisión de la primera previsualización

16 de noviembre de 2026. Propuesta elegida: «Cada paso importa»; las otras dos direcciones narrativas no se montaron.

Se construyeron diez escenas con capturas reales, encabezados de alto contraste y acercamientos a los controles. El cierre usa el logo original con revelado, cambio de escala del 96 al 100 %, destello único y pausa de lectura. Se revisa sin música por instrucción explícita del usuario.

## Comprobaciones

- HyperFrames 0.9.56: validación final `ok: true`, cero errores en lint, runtime, layout, movimiento y contraste; cero avisos de lint. Un aviso de oficio: `film_silent`, conservado deliberadamente. Audio inexistente; no se ha escuchado ni medido una mezcla.
- Se generaron 65 fotogramas de revisión (escenas y transiciones), hojas de escenas y hojas a tamaño de teléfono. Se inspeccionaron las hojas y fotogramas representativos. Después se repitieron los fotogramas de las dos escenas cuyos acercamientos se corrigieron y del cierre.
- Se corrigieron las líneas auxiliares de 26 a 30 px y la inicialización de los acercamientos para que la búsqueda temporal no altere el estado inicial.
- Previsualización local abierta en el puerto 4567, respuesta HTTP 200. Duración declarada: 76 s a 30 fps. Falta comprobar duración y fotogramas decodificados de la exportación final, que se hará después de revisar el montaje.

## Ajustes realizados y límites

- La captura planetaria completa fue costosa; se conservó un segmento real y se combinó con una captura del relieve. No se sustituyó por un planeta inventado.
- El mapa externo NASA falló; se usa el panel local de comparación. La leyenda del montaje aclara que esa comparación no certifica seguridad EVA.
- La primera grabación EVA llegó al final demasiado pronto; se repitió con pausa controlada. Se amplían los recursos usando una captura real del estado detenido después de mostrar el contexto en movimiento.
- La escena más débil es la de EVA: el mapa del producto tiene una zona sin textura a ese nivel de acercamiento. En una revisión posterior conviene corregir el encuadre o repetir la captura con mejor cobertura y dar más tiempo al perfil de elevación. Los detalles secundarios de la interfaz requieren pantalla grande; los títulos principales siguen siendo la guía en teléfono.
- No se verificó aún una exportación final a MP4 ni se revisó una mezcla de audio. Este trabajo es una primera previsualización, no una afirmación de que todas las capacidades del producto estén validadas.
