# Comercial GaleX — Cada paso importa

Segunda previsualización: 119,8 segundos, 1920 × 1080, 30 fps. Diecisiete escenas de funciones y cierre de marca. Cambio de función cada 5,4–7,4 segundos con transiciones solapadas de 0,6 s. Capturas de navegación y acciones reales; sin imágenes fijas sustituyendo las tomas de relieve, planificación o recursos. Sin música ni voz, por elección del usuario para esta revisión. No hay exportación MP4 final todavía.

```bash
cd video/galex-comercial
npx hyperframes@0.9.56 preview --port 4567
npx hyperframes@0.9.56 check --json
```

Previsualización de esta sesión: http://localhost:4567/#project/galex-comercial . El servidor local es independiente del servidor GaleX: reproduce medios capturados, sin volver a consultar NASA ni el backend de la aplicación.

Después de aprobar la previsualización:

```bash
npx hyperframes@0.9.56 render --quality delivery -o renders/galex-cada-paso-importa.mp4
```

`build_dynamic.py` regenera V2 y su inventario `coverage.json`. `build_scenes.py` conserva el generador de V1; no ejecutarlo sobre V2 sin guardar los cambios. Si se edita manualmente la composición en la previsualización, conservar esos cambios antes de volver a ejecutar un generador. El proyecto puede seguir editándose en la aplicación de escritorio HyperFrames.

## Procedencia

- Logo: archivo original proporcionado por el usuario, copiado sin alteración desde `a9365b4e-d745-493b-a38b-0d62ca961fc9.jpeg`.
- Videos y capturas: aplicación GaleX local del repositorio durante esta sesión; no son interfaces reconstruidas. En V2 se usó una ruta calculada y aceptada por el backend desde [137,45; −4,61] hacia Bradbury como escenario de demostración y se grabó el avance real de la simulación. La toma no representa una misión NASA real.
- Se capturó el producto actual, que incluye cambios posteriores al corte `0cec44d` del informe anterior (por ejemplo, interfaz de telemetría fisiológica y comparación cuantitativa). No modificar el producto para que coincida con un informe antiguo.
- Las grabaciones se retimaron a sus intervalos de montaje; no prueban tiempos de respuesta ni rendimiento. Las vistas 3D pueden requerir interpolación temporal para suavizar la menor cadencia de la captura; conservar el original antes de procesarlas.
- El mapa externo de NASA devolvió 404 durante la captura. La escena de rovers usa la comparación local que sí cargó y no promete un mapa en directo. No se corrigió esa integración dentro de este trabajo de video.
- El hallazgo de ejemplo se dejó pendiente en el almacenamiento del navegador de captura. Las peticiones de escritura se bloquearon durante la grabación para evitar introducir registros de demostración en el servidor del usuario; no se muestra una confirmación ficticia de guardado remoto.
- GSAP: copia local del archivo distribuido con HyperFrames 0.9.56, conservando su cabecera de licencia. El componente de registro `ui-focus-zoom` se conserva como referencia del principio de acercamiento utilizado; las escenas emplean sus propios contenedores de cámara.

V2 añade referencia de transición `iris-reveal`, navegación real por mapas y un script de captura en `capture/dynamic.mjs`. Ese script usa Puppeteer y Chrome locales indicados mediante `GALEX_PUPPETEER_MODULE` y `GALEX_BROWSER_PATH`, y requiere GaleX en el puerto 8016. El inventario completo de escenas está en `SPEC_V2.md` y `coverage.json`. La versión anterior queda conservada en Git (`132b408`).

## Revisión

Ver `REVIEW.md`. El único aviso conservado de la validación final es `film_silent`, por la revisión sin música solicitada. Los medios muestran los valores y rótulos de la aplicación; no certifican científicamente esos modelos o métricas.
