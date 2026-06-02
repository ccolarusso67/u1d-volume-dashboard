-- ============================================================================
-- 2026-04 operator narrative (monthly_operator_notes) — April board close.
-- Spanish (board deck operator-narrative slides are Spanish per CLAUDE.md).
-- PLAIN TEXT with bullet glyphs: the board page renders these with
-- whitespace-pre-wrap (not markdown), so no ** ** / "-" markdown syntax.
-- Idempotent UPSERT on (period_year, period_month). Re-running overwrites.
-- Run via:  railway connect Postgres   then  \i db/data/2026-04_operator_notes.sql
-- ============================================================================

INSERT INTO u1d_ops.monthly_operator_notes
  (period_year, period_month, capacity_md, supply_chain_md, quality_md, initiatives_md, risks_md, completed_by, completed_at)
VALUES (
  2026, 4,
  $md$Producción Q1: 374,866 gal (+28.2% vs Q1 2025).

• Promedio mensual: 127,372 gal. Pico: marzo 141,506 gal.
• Mix: Aceite 63.3% · Coolant 30.3% · DEF 4.4% · WW 2.1%.
• Coolant consolidado como segundo motor del negocio (8.5% → 30.3% en 28 meses).
• Ritmo anualizado proyecta ~1.50M gal/año (proyección lineal Q1).
• Eficiencia de 8 líneas (85 días hábiles ene–abr): línea Quarts en su techo real (~1,208 gal/día, 96.5% disponibilidad) — cuello de botella primario identificado.
• Líneas batch (5-Qts, Box Gal) eficientes cuando operan (68% y 48%).
• Capacidad nominal Drums/Totes requiere recalibración — las cifras teóricas no reflejan el patrón real de operación.$md$,

  $md$• Dependencia de Lubrimar como único proveedor activo para aceites.
• Dependencia de proveedores de envases con lead times de reposición de insumos críticos y temas de calidad: envases Gal/5QT y tambores.$md$,

  $md$Hallazgo de baseline: al inicio de esta gestión no existen registros formales de QA ni testigos de producto terminado (envasado o formulado).

• No se documentan resultados de análisis ni se mantiene registro formal en formatos de control.
• Un incidente menor por no usar EPP (lentes de seguridad). No hay registro de incidentes en planta (OSHA 300 Log) ni procedimientos formales.$md$,

  $md$1. Infraestructura de medición: levantar registro de downtime, fill accuracy, schedule adherence y tiempo de procesamiento de órdenes.
2. Acción en marcha: desarrollo de formatos para registro de QA y procedimientos para levantar archivos de producción.
3. Línea Quarts: evaluación de modernización; propuesta de línea nueva y conversión de la actual a formato Gal/5-Qt para aliviar la restricción en Qt y capturar la demanda creciente en formatos de mayor volumen.
4. Almacenamiento: evaluación de techo temporal adicional para incrementar el espacio techado — dos propuestas a evaluar.
5. Inventario físico: programación necesaria; reconciliación con sistema en progreso (propuesta).
6. DEF: presentación al board de escenarios (Continuar / Escala mínima / Salida).
7. Tambores: acuerdo concretado con proveedor alternativo (Q2).
8. Desechos: sustituido el proveedor — ahorro significativo (Q2).$md$,

  $md$• ALTO — Ausencia de infraestructura de medición operacional y de QA: gestión de reclamos.
• ALTO — Concentración de proveedores clave sin respaldo: Lubrimar, empaques.
• ALTO — Disrupciones por guerra en Irán / materia prima / incremento de precios.
• MED — Archivos QA: no hay base cero documentada de productos formulados en planta (Coolant en sus varias presentaciones).
• MED — Posición real de inventario estimada: no hay conciliaciones con inventario físico; ineficiencias en el proceso de producción y procura.$md$,

  'ep@ultra1plus.com',
  NOW()
)
ON CONFLICT (period_year, period_month) DO UPDATE SET
  capacity_md     = EXCLUDED.capacity_md,
  supply_chain_md = EXCLUDED.supply_chain_md,
  quality_md      = EXCLUDED.quality_md,
  initiatives_md  = EXCLUDED.initiatives_md,
  risks_md        = EXCLUDED.risks_md,
  completed_by    = EXCLUDED.completed_by,
  completed_at    = NOW();
