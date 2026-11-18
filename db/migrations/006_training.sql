-- Entrenamiento desde /admin (correcciones + fichas verificadas). Re-ejecutable.

-- Una corrección queda ligada al turno exacto que se corrigió (una por turno).
alter table chat_feedback add column if not exists event_id bigint;
create unique index if not exists chat_feedback_event_uidx on chat_feedback(event_id) where event_id is not null;
create index if not exists chat_feedback_status_idx on chat_feedback(status, resolved_at desc);

-- En el VPS el catálogo vive en archivos (catalogo/*.txt|json), no en la tabla products:
-- la FK impedía guardar fichas verificadas por el dueño.
alter table product_attributes drop constraint if exists product_attributes_product_url_fkey;
