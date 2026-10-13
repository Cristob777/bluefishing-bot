-- Etapas del embudo BlueFishing en Atomic CRM (configuration.config.dealStages).
-- Alternativa recomendada: configurarlas desde la UI (Settings / Application Settings).
-- Los "value" DEBEN coincidir con lib/atomicCrmSync.js (nuevo, interesado, cotizado, compro, perdido).
insert into public.configuration (id, config) values (1, '{}'::jsonb) on conflict (id) do nothing;
update public.configuration
set config = jsonb_set(
  jsonb_set(config, '{dealStages}', '[
    {"value":"nuevo","label":"Nuevo"},
    {"value":"interesado","label":"Interesado"},
    {"value":"cotizado","label":"Cotizado"},
    {"value":"compro","label":"Compró"},
    {"value":"perdido","label":"Perdido"}
  ]'::jsonb, true),
  '{dealPipelineStatuses}', '["compro"]'::jsonb, true)
where id = 1;
