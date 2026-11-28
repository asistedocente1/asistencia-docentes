-- =====================================================================
-- MIGRACIÓN 03 · Reportes de horas emitidos (folio, sello digital y cadena original)
--
-- Ejecutar DESPUÉS de 02a y 02b. No borra datos y se puede repetir.
-- Supabase > SQL Editor > New query > pegar todo > Run.
--
-- Agrega:
--   · reportes_horas / reportes_horas_detalle: cada reporte emitido queda guardado
--     con su folio, la fotografía de las clases incluidas, su cadena original y su sello.
--   · Un reporte emitido NO se puede editar ni borrar; solo anular (con motivo).
--   · Una sesión (asistencia) solo puede estar en UN reporte vigente: evita pagar dos veces.
--   · reporte_horas_clases(): horas por clase para las casillas de la pantalla de reportes.
-- =====================================================================

create sequence if not exists public.reportes_horas_folio_seq;

-- ---------- Tablas ----------
create table if not exists public.reportes_horas (
  id                uuid primary key,
  folio             bigint not null unique,
  profesor_id       uuid not null references public.profiles(id),
  profesor_nombre   text not null,
  desde             date not null,
  hasta             date not null,
  tarifa            numeric(10,2) not null,
  total_minutos     int not null check (total_minutos > 0),
  monto             numeric(12,2) not null,
  num_sesiones      int not null check (num_sesiones > 0),
  fecha_emision     timestamptz not null,
  cadena_original   text not null,
  sello             text not null,
  serie             text not null,
  emitido_por       uuid references public.profiles(id),
  emitido_por_nombre text,
  estado            text not null default 'vigente' check (estado in ('vigente','anulado')),
  anulado_at        timestamptz,
  anulado_por       uuid references public.profiles(id),
  anulado_motivo    text,
  created_at        timestamptz not null default now(),
  check (hasta >= desde)
);

create table if not exists public.reportes_horas_detalle (
  id            bigint generated always as identity primary key,
  reporte_id    uuid not null references public.reportes_horas(id),
  asistencia_id uuid not null references public.asistencias(id),
  clase_id      uuid not null references public.clases(id),
  fecha         date not null,
  materia       text not null,
  grupo         text not null,
  plantel       text not null,
  dia_semana    smallint not null check (dia_semana between 1 and 7),
  hora_inicio   time not null,
  hora_fin      time not null,
  minutos       int not null check (minutos > 0),
  activo        boolean not null default true
);

-- Una sesión solo puede pertenecer a un reporte VIGENTE
create unique index if not exists reportes_detalle_asistencia_activa
  on public.reportes_horas_detalle (asistencia_id) where activo;
create index if not exists reportes_detalle_reporte_idx on public.reportes_horas_detalle (reporte_id);
create index if not exists reportes_profesor_idx on public.reportes_horas (profesor_id, desde);
create index if not exists reportes_fecha_idx on public.reportes_horas (fecha_emision desc);

-- ---------- Inmutabilidad ----------
create or replace function public.trg_reportes_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception 'Los reportes emitidos no se pueden borrar; anúlalos con un motivo.';
  end if;
  -- UPDATE: solo se permite anular
  if (to_jsonb(new) - 'estado' - 'anulado_at' - 'anulado_por' - 'anulado_motivo')
     is distinct from
     (to_jsonb(old) - 'estado' - 'anulado_at' - 'anulado_por' - 'anulado_motivo') then
    raise exception 'Un reporte emitido no se puede modificar; anúlalo y emite otro.';
  end if;
  if old.estado = 'anulado' and new.estado is distinct from 'anulado' then
    raise exception 'Un reporte anulado no se puede reactivar.';
  end if;
  return new;
end $$;

create or replace function public.trg_reportes_detalle_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception 'El detalle de un reporte emitido no se puede borrar.';
  end if;
  if (to_jsonb(new) - 'activo') is distinct from (to_jsonb(old) - 'activo') then
    raise exception 'El detalle de un reporte emitido no se puede modificar.';
  end if;
  if old.activo = false and new.activo = true then
    raise exception 'Un reporte anulado no se puede reactivar.';
  end if;
  return new;
end $$;

drop trigger if exists reportes_inmutable on public.reportes_horas;
create trigger reportes_inmutable before update or delete on public.reportes_horas
  for each row execute function public.trg_reportes_inmutable();
drop trigger if exists reportes_inmutable_trunc on public.reportes_horas;
create trigger reportes_inmutable_trunc before truncate on public.reportes_horas
  for each statement execute function public.trg_reportes_inmutable();

drop trigger if exists reportes_detalle_inmutable on public.reportes_horas_detalle;
create trigger reportes_detalle_inmutable before update or delete on public.reportes_horas_detalle
  for each row execute function public.trg_reportes_detalle_inmutable();
drop trigger if exists reportes_detalle_inmutable_trunc on public.reportes_horas_detalle;
create trigger reportes_detalle_inmutable_trunc before truncate on public.reportes_horas_detalle
  for each statement execute function public.trg_reportes_detalle_inmutable();

-- ---------- Permisos: solo lectura para el personal; escribe únicamente el servidor ----------
alter table public.reportes_horas         enable row level security;
alter table public.reportes_horas_detalle enable row level security;

drop policy if exists reportes_select on public.reportes_horas;
create policy reportes_select on public.reportes_horas for select to authenticated
  using (public.es_staff());
drop policy if exists reportes_detalle_select on public.reportes_horas_detalle;
create policy reportes_detalle_select on public.reportes_horas_detalle for select to authenticated
  using (public.es_staff());

revoke all on public.reportes_horas, public.reportes_horas_detalle from anon, authenticated;
grant select on public.reportes_horas, public.reportes_horas_detalle to authenticated;
grant all on public.reportes_horas, public.reportes_horas_detalle to service_role;
revoke all on sequence public.reportes_horas_folio_seq from anon, authenticated;
grant usage, select on sequence public.reportes_horas_folio_seq to service_role;

-- ---------- Funciones internas (solo las usa la API del servidor con service_role) ----------
create or replace function public._reporte_siguiente_folio()
returns bigint language sql security definer set search_path = public as $$
  select nextval('public.reportes_horas_folio_seq')
$$;

-- Sesiones de un profesor y clases elegidas que todavía NO están en un reporte vigente
create or replace function public._reporte_candidatas(
  p_profesor uuid, p_desde date, p_hasta date, p_clases uuid[]
) returns table (
  asistencia_id uuid, clase_id uuid, fecha date, materia text, grupo text, plantel text,
  dia_semana int, hora_inicio time, hora_fin time, minutos int
) language sql stable security definer set search_path = public as $$
  select a.id, c.id, a.fecha, c.materia, c.grupo, c.plantel,
         extract(isodow from a.fecha)::int,
         coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin),
         least(floor(extract(epoch from (a.salida - a.entrada)) / 60)::int,
               (extract(epoch from (coalesce(a.prog_fin, c.hora_fin) - coalesce(a.prog_inicio, c.hora_inicio))) / 60)::int)
    from public.asistencias a
    join public.clases c on c.id = a.clase_id
   where a.profesor_id = p_profesor
     and a.fecha between p_desde and p_hasta
     and a.clase_id = any (p_clases)
     and a.salida is not null
     and not exists (select 1 from public.reportes_horas_detalle d where d.asistencia_id = a.id and d.activo)
   order by c.materia, c.grupo, a.fecha
$$;

-- Guarda el reporte y su detalle en una sola transacción
create or replace function public._reporte_guardar(p jsonb, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := (p->>'id')::uuid;
  v_rep   jsonb := p->'reporte';
  v_suma  bigint;
  v_nombre text;
begin
  select full_name into v_nombre from public.profiles where id = p_actor;

  insert into public.reportes_horas
    (id, folio, profesor_id, profesor_nombre, desde, hasta, tarifa, total_minutos, monto, num_sesiones,
     fecha_emision, cadena_original, sello, serie, emitido_por, emitido_por_nombre)
  values
    (v_id, (v_rep->>'folio')::bigint, (v_rep->>'profesor_id')::uuid, v_rep->>'profesor_nombre',
     (v_rep->>'desde')::date, (v_rep->>'hasta')::date, (v_rep->>'tarifa')::numeric,
     (v_rep->>'total_minutos')::int, (v_rep->>'monto')::numeric, (v_rep->>'num_sesiones')::int,
     (v_rep->>'fecha_emision')::timestamptz, v_rep->>'cadena_original', v_rep->>'sello', v_rep->>'serie',
     p_actor, v_nombre);

  insert into public.reportes_horas_detalle
    (reporte_id, asistencia_id, clase_id, fecha, materia, grupo, plantel, dia_semana, hora_inicio, hora_fin, minutos)
  select v_id, (d->>'asistencia_id')::uuid, (d->>'clase_id')::uuid, (d->>'fecha')::date,
         d->>'materia', d->>'grupo', d->>'plantel', (d->>'dia_semana')::smallint,
         (d->>'hora_inicio')::time, (d->>'hora_fin')::time, (d->>'minutos')::int
    from jsonb_array_elements(p->'detalle') d;

  select coalesce(sum(minutos), 0) into v_suma from public.reportes_horas_detalle where reporte_id = v_id;
  if v_suma <> (v_rep->>'total_minutos')::bigint
     or (select count(*) from public.reportes_horas_detalle where reporte_id = v_id) <> (v_rep->>'num_sesiones')::int then
    raise exception 'El detalle no coincide con el total del reporte';
  end if;

  perform public.log_bitacora(p_actor, 'reporte.emitir', 'reporte', v_id::text,
    format('Emitió el reporte de horas folio %s de %s (%s al %s): %s h, $%s',
           v_rep->>'folio', v_rep->>'profesor_nombre', v_rep->>'desde', v_rep->>'hasta',
           to_char((v_rep->>'total_minutos')::numeric / 60, 'FM990.00'),
           to_char((v_rep->>'monto')::numeric, 'FM999,999,990.00')),
    jsonb_build_object('folio', (v_rep->>'folio')::bigint, 'profesor_id', v_rep->>'profesor_id',
                       'sesiones', (v_rep->>'num_sesiones')::int));
  return v_id;
exception when unique_violation then
  raise exception 'Alguna de las clases ya fue incluida en otro reporte vigente';
end $$;

create or replace function public._reporte_anular(p_id uuid, p_actor uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_folio bigint; v_nombre text;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Escribe el motivo de la anulación (mínimo 5 caracteres)';
  end if;
  update public.reportes_horas
     set estado = 'anulado', anulado_at = now(), anulado_por = p_actor, anulado_motivo = trim(p_motivo)
   where id = p_id and estado = 'vigente'
  returning folio, profesor_nombre into v_folio, v_nombre;
  if not found then raise exception 'El reporte no existe o ya está anulado'; end if;

  update public.reportes_horas_detalle set activo = false where reporte_id = p_id and activo;

  perform public.log_bitacora(p_actor, 'reporte.anular', 'reporte', p_id::text,
    format('Anuló el reporte de horas folio %s de %s. Motivo: %s', v_folio, v_nombre, trim(p_motivo)),
    jsonb_build_object('folio', v_folio, 'motivo', trim(p_motivo)));
end $$;

revoke all on function public._reporte_siguiente_folio()                   from public, anon, authenticated;
revoke all on function public._reporte_candidatas(uuid, date, date, uuid[]) from public, anon, authenticated;
revoke all on function public._reporte_guardar(jsonb, uuid)                 from public, anon, authenticated;
revoke all on function public._reporte_anular(uuid, uuid, text)             from public, anon, authenticated;
grant execute on function public._reporte_siguiente_folio()                   to service_role;
grant execute on function public._reporte_candidatas(uuid, date, date, uuid[]) to service_role;
grant execute on function public._reporte_guardar(jsonb, uuid)                 to service_role;
grant execute on function public._reporte_anular(uuid, uuid, text)             to service_role;

-- ---------- Horas por clase (para las casillas de "Reportes de horas") ----------
create or replace function public.reporte_horas_clases(p_desde date, p_hasta date)
returns table (
  profesor_id uuid, clase_id uuid, materia text, grupo text, plantel text, modalidad text,
  dia_semana int, hora_inicio time, hora_fin time,
  sesiones_pendientes bigint, minutos_pendientes bigint,
  sesiones_reportadas bigint, minutos_reportados bigint,
  sin_salida bigint, folios text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return query
  with s as (
    select a.id, a.clase_id, a.salida,
           case when a.salida is not null then
             least(floor(extract(epoch from (a.salida - a.entrada)) / 60)::int,
                   (extract(epoch from (coalesce(a.prog_fin, c.hora_fin) - coalesce(a.prog_inicio, c.hora_inicio))) / 60)::int)
           end as min_pag,
           (select r.folio from public.reportes_horas_detalle d
              join public.reportes_horas r on r.id = d.reporte_id
             where d.asistencia_id = a.id and d.activo limit 1) as folio
      from public.asistencias a
      join public.clases c on c.id = a.clase_id
     where a.fecha between p_desde and p_hasta
  )
  select c.profesor_id, c.id, c.materia, c.grupo, c.plantel, c.modalidad, c.dia_semana::int,
         c.hora_inicio, c.hora_fin,
         count(*) filter (where s.salida is not null and s.folio is null),
         coalesce(sum(s.min_pag) filter (where s.salida is not null and s.folio is null), 0)::bigint,
         count(*) filter (where s.folio is not null),
         coalesce(sum(s.min_pag) filter (where s.folio is not null), 0)::bigint,
         count(*) filter (where s.salida is null),
         string_agg(distinct s.folio::text, ', ')
    from s
    join public.clases c on c.id = s.clase_id
   group by c.id
   order by c.materia, c.grupo;
end $$;

revoke execute on function public.reporte_horas_clases(date, date) from public, anon;
grant  execute on function public.reporte_horas_clases(date, date) to authenticated;
