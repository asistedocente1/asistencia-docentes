-- =====================================================================
-- MIGRACIÓN 02 · PASO A  (ejecutar PRIMERO y SOLO este archivo)
-- Agrega el rol "apertura" (usuarios que solo habilitan la apertura de clases).
--
-- Supabase > SQL Editor > New query > pegar > Run.
-- Debe ejecutarse por separado del paso B: PostgreSQL no permite usar un
-- valor nuevo de un enum en la misma transacción en que se crea.
-- =====================================================================

alter type public.app_role add value if not exists 'apertura';
