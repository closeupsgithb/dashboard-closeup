# Protocolo de ingesta de reuniones Fathom

## Objetivo

Incorporar cada reunión sin perder la fuente original ni contaminar los acuerdos con interpretaciones.

## Entrada aceptada

- transcripción completa;
- resumen de Fathom;
- enlace o referencia de grabación;
- notas de Daniel;
- documentos compartidos durante la sesión.

## Paso 1 — Registrar la fuente

Crear:

`reuniones/AAAA-MM-DD_TRANSCRIPCION_COMPLETA.md`

Encabezado mínimo:

- fecha;
- participantes;
- duración;
- tipo de fuente;
- disponibilidad de grabación;
- calidad de transcripción;
- archivos relacionados.

No corregir el cuerpo original. Si existe una transcripción mejorada, conservar ambas y señalar su origen.

## Paso 2 — Crear resumen ejecutivo

Crear:

`reuniones/AAAA-MM-DD_RESUMEN_EJECUTIVO.md`

Debe contener:

- propósito;
- contexto;
- temas tratados;
- hechos;
- decisiones;
- propuestas;
- cifras;
- próximos pasos;
- dependencias.

No debe ser una reproducción cronológica. Debe explicar qué importa para el negocio.

## Paso 3 — Crear conclusiones y acciones

Crear:

`reuniones/AAAA-MM-DD_CONCLUSIONES_Y_ACCIONES.md`

Debe incluir:

- conclusiones estratégicas;
- cambios frente a la sesión anterior;
- acciones con ID;
- responsable;
- prioridad;
- estado;
- criterio de cierre;
- KPI;
- decisiones pendientes;
- preparación para la siguiente sesión.

## Paso 4 — Clasificar

Usar:

- `CONFIRMADO`
- `DECIDIDO`
- `PROPUESTO`
- `HIPÓTESIS`
- `PENDIENTE`
- `DESCARTADO`
- `SUSTITUIDO`

## Paso 5 — Comparar

Responder:

- ¿Qué decisión nueva aparece?
- ¿Qué decisión anterior cambia?
- ¿Qué tarea se completa?
- ¿Qué tarea sigue pendiente?
- ¿Qué ejemplo se utilizó sin convertirse en acuerdo?
- ¿Qué cifra requiere verificación?
- ¿Qué contradicción existe?

## Paso 6 — Actualizar base

Actualizar únicamente lo afectado:

- contexto maestro;
- estado y roadmap;
- archivo del nicho;
- infraestructura;
- registro de decisiones;
- fuentes y lagunas.
- changelog.

No reescribir todo si solo cambia un estado.

## Paso 7 — Control de calidad

Antes de terminar:

- comprobar fecha y nombres;
- verificar que la transcripción original siga intacta;
- comprobar que todas las acciones tengan responsable;
- evitar duplicados;
- no marcar tareas completadas sin evidencia;
- revisar que los precios sean decisiones y no ejemplos;
- revisar que los nichos elegidos no sean ejemplos;
- registrar archivos faltantes;
- comprobar enlaces internos.

## Salida al usuario

Informar solo:

1. qué cambió;
2. tres prioridades;
3. decisiones que Daniel debe validar;
4. bloqueos;
5. archivos actualizados.
