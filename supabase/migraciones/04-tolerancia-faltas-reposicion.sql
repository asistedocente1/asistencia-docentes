-- =====================================================================
-- MIGRACIÓN 04 · Tolerancia de 10 min, faltas en el reporte y reposición de clases
--
-- Ejecutar DESPUÉS de 03. No borra datos y se puede repetir.
-- Supabase > SQL Editor > New query > pegar todo > Run.
--
-- Reglas nuevas:
--  · Tolerancia: hasta 10 min de retardo NO se descuentan (se paga la clase completa).
--    Si llega con más de 10 min de retardo, se descuenta TODO el retardo (desde la hora de inicio).
--    (Cambiar la tolerancia: función tolerancia_min()).
--  · Las faltas aparecen en el reporte de horas (y se marcan si ya fueron repuestas).
--  · Reposición: en «Apertura de clases» se puede abrir una reposición de una clase en la que
--    el docente faltó. Se paga como una clase normal y queda ligada a la falta que repone.
-- =====================================================================

-- ---------- 1. Constantes de negocio ----------
create or replace function public.tolerancia_min() returns int language sql immutable as $$ select 10 $$;
-- Una falta se puede reponer durante los siguientes N días
create or replace function public.reposicion_dias_max() returns int language sql immutable as $$ select 60 $$;

-- Minutos a pagar de una sesión (misma regla en vistas, reportes y reporte emitido)
create or replace function public.minutos_pagables(
  p_entrada timestamptz, p_salida timestamptz, p_retardo int, p_ini time, p_fin time
) returns int language sql stable as $$
  select case when p_salida is null then null else
    greatest(0, least(
      floor(extract(epoch from (p_salida - p_entrada)) / 60)::int
        + case when p_retardo between 1 and public.tolerancia_min() then p_retardo else 0 end,
      (extract(epoch from (p_fin - p_ini)) / 60)::int
        - case when p_retardo > public.tolerancia_min() then p_retardo else 0 end))
  end
$$;

-- Minutos descontados por retardo (solo si excede la tolerancia)
create or replace function public.descuento_retardo(p_retardo int) returns int language sql stable as $$
  select case when p_retardo > public.tolerancia_min() then p_retardo else 0 end
$$;

-- ---------- 2. Asistencias: reposiciones ----------
alter table public.asistencias add column if not exists es_reposicion boolean not null default false;
alter table public.asistencias add column if not exists reposicion_de date;
alter table public.asistencias drop constraint if exists asistencias_clase_id_fecha_key;
alter table public.asistencias drop constraint if exists asistencias_repo_chk;
alter table public.asistencias add constraint asistencias_repo_chk check (es_reposicion = (reposicion_de is not null));
create unique index if not exists asistencias_clase_fecha_tipo
  on public.asistencias (clase_id, fecha, (coalesce(reposicion_de, date '1900-01-01')));
create unique index if not exists asistencias_reposicion_unica
  on public.asistencias (clase_id, reposicion_de) where es_reposicion;

-- ---------- 3. Faltas (clase programada, ya concluida, sin registro) ----------
create or replace function public._faltas(p_desde date, p_hasta date)
returns table (
  fecha date, clase_id uuid, profesor_id uuid, profesor_nombre text, materia text, grupo text,
  plantel text, modalidad text, hora_inicio time, hora_fin time, repuesta_fecha date
)
language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := (now() at time zone 'America/Mexico_City');
begin
  return query
  select d::date, c.id, c.profesor_id, p.full_name, c.materia, c.grupo, c.plantel, c.modalidad,
         c.hora_inicio, c.hora_fin,
         (select r.fecha from public.asistencias r
           where r.clase_id = c.id and r.es_reposicion and r.reposicion_de = d::date limit 1)
    from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d
    join public.clases   c on c.activo and c.dia_semana = extract(isodow from d)::int
                           and (c.created_at at time zone 'America/Mexico_City')::date <= d::date
    join public.profiles p on p.id = c.profesor_id
    left join public.asistencias a on a.clase_id = c.id and a.fecha = d::date and not a.es_reposicion
   where a.id is null
     and (d::date < v_local::date or (d::date = v_local::date and c.hora_fin <= v_local::time))
   order by 1, 5;
end $$;
revoke all on function public._faltas(date, date) from public, anon, authenticated;
grant execute on function public._faltas(date, date) to service_role;

drop function if exists public.reporte_faltas(date, date);
create function public.reporte_faltas(p_desde date, p_hasta date)
returns table (
  fecha date, profesor_id uuid, profesor_nombre text, materia text, grupo text,
  plantel text, hora_inicio time, hora_fin time, clase_id uuid, repuesta_fecha date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return query
  select f.fecha, f.profesor_id, f.profesor_nombre, f.materia, f.grupo, f.plantel, f.hora_inicio, f.hora_fin,
         f.clase_id, f.repuesta_fecha
    from public._faltas(p_desde, p_hasta) f;
end $$;
revoke execute on function public.reporte_faltas(date, date) from public, anon;
grant  execute on function public.reporte_faltas(date, date) to authenticated;

-- Faltas que todavía se pueden reponer (módulo «Apertura de clases»)
create or replace function public.apertura_faltas()
returns table (
  clase_id uuid, fecha date, materia text, grupo text, plantel text, modalidad text,
  hora_inicio time, hora_fin time, profesor_id uuid, profesor_nombre text
)
language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Mexico_City')::date;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso';
  end if;
  return query
  select f.clase_id, f.fecha, f.materia, f.grupo, f.plantel, f.modalidad, f.hora_inicio, f.hora_fin,
         f.profesor_id, f.profesor_nombre
    from public._faltas(v_hoy - public.reposicion_dias_max(), v_hoy) f
    join public.profiles p on p.id = f.profesor_id and p.active
   where f.repuesta_fecha is null
   order by f.fecha desc, f.profesor_nombre;
end $$;
revoke execute on function public.apertura_faltas() from public, anon;
grant  execute on function public.apertura_faltas() to authenticated;

-- ---------- 4. Abrir / cerrar clases (con reposición) ----------
drop function if exists public._abrir_clase(uuid, uuid, text);
drop function if exists public._cerrar_clase(uuid, uuid, text);
drop function if exists public.abrir_clase(uuid);
drop function if exists public.cerrar_clase(uuid);

create or replace function public._abrir_clase(p_clase_id uuid, p_actor uuid, p_metodo text, p_repo_de date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clase   public.clases%rowtype;
  v_local   timestamp := (now() at time zone 'America/Mexico_City');
  v_id      uuid;
  v_retardo int := 0;
  v_prof    text;
begin
  select * into v_clase from public.clases where id = p_clase_id and activo;
  if not found then raise exception 'Clase no encontrada o inactiva'; end if;

  if p_repo_de is null then
    if extract(isodow from v_local)::int <> v_clase.dia_semana then
      raise exception 'Esta clase no corresponde al día de hoy';
    end if;
    if v_local::time < (v_clase.hora_inicio - interval '30 minutes') then
      raise exception 'Aún no se puede abrir (se habilita 30 min antes del inicio)';
    end if;
    if v_local::time >= v_clase.hora_fin then
      raise exception 'La clase ya terminó';
    end if;
    v_retardo := greatest(0, floor(extract(epoch from (v_local::time - v_clase.hora_inicio)) / 60))::int;
  else
    -- Reposición: debe corresponder a una falta real y reciente
    if extract(isodow from p_repo_de)::int <> v_clase.dia_semana then
      raise exception 'La fecha indicada no corresponde a un día de esta clase';
    end if;
    if p_repo_de > v_local::date or (p_repo_de = v_local::date and v_local::time < v_clase.hora_fin) then
      raise exception 'Esa clase aún no se considera falta';
    end if;
    if p_repo_de < v_local::date - public.reposicion_dias_max() then
      raise exception 'Ya pasó el plazo para reponer esa falta (% días)', public.reposicion_dias_max();
    end if;
    if (v_clase.created_at at time zone 'America/Mexico_City')::date > p_repo_de then
      raise exception 'La clase todavía no existía en esa fecha';
    end if;
    if exists (select 1 from public.asistencias where clase_id = p_clase_id and fecha = p_repo_de and not es_reposicion) then
      raise exception 'Esa fecha sí tiene registro de asistencia: no es falta';
    end if;
    if exists (select 1 from public.asistencias where clase_id = p_clase_id and es_reposicion and reposicion_de = p_repo_de) then
      raise exception 'Esa falta ya fue repuesta';
    end if;
  end if;

  insert into public.asistencias
    (clase_id, profesor_id, fecha, entrada, retardo_min, prog_inicio, prog_fin, modalidad, abierta_por,
     es_reposicion, reposicion_de)
  values
    (v_clase.id, v_clase.profesor_id, v_local::date, now(), v_retardo,
     v_clase.hora_inicio, v_clase.hora_fin, v_clase.modalidad, p_actor,
     p_repo_de is not null, p_repo_de)
  returning id into v_id;

  select full_name into v_prof from public.profiles where id = v_clase.profesor_id;
  if p_repo_de is null then
    perform public.log_bitacora(p_actor, 'clase.abrir', 'asistencia', v_id::text,
      format('Abrió la clase %s (%s) de %s [%s]', v_clase.materia, v_clase.grupo, coalesce(v_prof, '—'), p_metodo),
      jsonb_build_object('clase_id', v_clase.id, 'profesor_id', v_clase.profesor_id,
                         'metodo', p_metodo, 'retardo_min', v_retardo));
  else
    perform public.log_bitacora(p_actor, 'clase.reposicion', 'asistencia', v_id::text,
      format('Abrió una REPOSICIÓN de la clase %s (%s) de %s, por la falta del %s [%s]',
             v_clase.materia, v_clase.grupo, coalesce(v_prof, '—'), to_char(p_repo_de, 'DD/MM/YYYY'), p_metodo),
      jsonb_build_object('clase_id', v_clase.id, 'profesor_id', v_clase.profesor_id,
                         'metodo', p_metodo, 'falta', p_repo_de));
  end if;
  return v_id;
exception when unique_violation then
  if p_repo_de is null then raise exception 'Esta clase ya fue abierta hoy';
  else raise exception 'Esta reposición ya fue abierta'; end if;
end $$;

create or replace function public._cerrar_clase(p_clase_id uuid, p_actor uuid, p_metodo text, p_repo_de date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := (now() at time zone 'America/Mexico_City');
  v_id    uuid;
  v_clase public.clases%rowtype;
  v_prof  text;
begin
  update public.asistencias
     set salida = now(), cerrada_por = p_actor
   where clase_id = p_clase_id and fecha = v_local::date and salida is null
     and es_reposicion = (p_repo_de is not null)
     and (p_repo_de is null or reposicion_de = p_repo_de)
  returning id into v_id;
  if v_id is null then raise exception 'No hay una clase abierta para cerrar'; end if;

  select * into v_clase from public.clases where id = p_clase_id;
  select full_name into v_prof from public.profiles where id = v_clase.profesor_id;
  perform public.log_bitacora(p_actor, 'clase.cerrar', 'asistencia', v_id::text,
    format('Registró la salida de la %s %s (%s) de %s [%s]', case when p_repo_de is null then 'clase' else 'reposición de la clase' end,
           v_clase.materia, v_clase.grupo, coalesce(v_prof, '—'), p_metodo),
    jsonb_build_object('clase_id', p_clase_id, 'profesor_id', v_clase.profesor_id, 'metodo', p_metodo));
  return v_id;
end $$;

revoke all on function public._abrir_clase(uuid, uuid, text, date)  from public, anon, authenticated;
revoke all on function public._cerrar_clase(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public._abrir_clase(uuid, uuid, text, date)  to service_role;
grant execute on function public._cerrar_clase(uuid, uuid, text, date) to service_role;

create or replace function public.abrir_clase(p_clase_id uuid, p_repo_de date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mod text;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso para abrir clases';
  end if;
  select modalidad into v_mod from public.clases where id = p_clase_id;
  if v_mod is null then raise exception 'Clase no encontrada'; end if;
  if v_mod <> 'presencial' then
    raise exception 'Las clases en línea requieren la contraseña del profesor';
  end if;
  return public._abrir_clase(p_clase_id, auth.uid(), 'presencial', p_repo_de);
end $$;

create or replace function public.cerrar_clase(p_clase_id uuid, p_repo_de date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mod text;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso para cerrar clases';
  end if;
  select modalidad into v_mod from public.clases where id = p_clase_id;
  if v_mod is null then raise exception 'Clase no encontrada'; end if;
  if v_mod <> 'presencial' then
    raise exception 'Las clases en línea requieren la contraseña del profesor';
  end if;
  return public._cerrar_clase(p_clase_id, auth.uid(), 'presencial', p_repo_de);
end $$;

revoke execute on function public.abrir_clase(uuid, date)  from public, anon;
revoke execute on function public.cerrar_clase(uuid, date) from public, anon;
grant  execute on function public.abrir_clase(uuid, date)  to authenticated;
grant  execute on function public.cerrar_clase(uuid, date) to authenticated;

-- Clases del día (y reposiciones de hoy) para los recuadros
drop function if exists public.apertura_del_dia();
create function public.apertura_del_dia()
returns table (
  clase_id uuid, materia text, grupo text, plantel text, modalidad text,
  hora_inicio time, hora_fin time, profesor_id uuid, profesor_nombre text,
  asistencia_id uuid, entrada timestamptz, salida timestamptz, retardo_min int, ahora time,
  es_reposicion boolean, reposicion_de date
)
language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := (now() at time zone 'America/Mexico_City');
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso';
  end if;
  return query
  select * from (
    select c.id, c.materia, c.grupo, c.plantel, c.modalidad,
           c.hora_inicio, c.hora_fin, c.profesor_id, p.full_name,
           a.id as aid, a.entrada, a.salida, a.retardo_min, v_local::time as ahora,
           false as es_reposicion, null::date as reposicion_de
      from public.clases c
      join public.profiles p on p.id = c.profesor_id and p.active
      left join public.asistencias a on a.clase_id = c.id and a.fecha = v_local::date and not a.es_reposicion
     where c.activo and c.dia_semana = extract(isodow from v_local)::int
    union all
    select c.id, c.materia, c.grupo, c.plantel, c.modalidad,
           c.hora_inicio, c.hora_fin, c.profesor_id, p.full_name,
           a.id, a.entrada, a.salida, a.retardo_min, v_local::time,
           true, a.reposicion_de
      from public.asistencias a
      join public.clases c on c.id = a.clase_id
      join public.profiles p on p.id = a.profesor_id
     where a.fecha = v_local::date and a.es_reposicion
  ) x
  order by x.hora_inicio, x.full_name;
end $$;
revoke execute on function public.apertura_del_dia() from public, anon;
grant  execute on function public.apertura_del_dia() to authenticated;

-- ---------- 5. Vista y reporte de horas con la regla de tolerancia ----------
drop view if exists public.asistencias_detalle;
create view public.asistencias_detalle with (security_invoker = true) as
select
  a.id, a.fecha, a.profesor_id,
  p.full_name  as profesor_nombre,
  p.hourly_rate,
  c.materia, c.grupo, c.plantel,
  coalesce(a.prog_inicio, c.hora_inicio) as hora_inicio,
  coalesce(a.prog_fin,    c.hora_fin)    as hora_fin,
  a.entrada, a.salida, a.retardo_min, a.foto_entrada, a.foto_salida,
  (extract(epoch from (coalesce(a.prog_fin, c.hora_fin) - coalesce(a.prog_inicio, c.hora_inicio))) / 60)::int
      as minutos_programados,
  case when a.salida is not null
       then floor(extract(epoch from (a.salida - a.entrada)) / 60)::int end as minutos_trabajados,
  public.minutos_pagables(a.entrada, a.salida, a.retardo_min,
        coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin)) as minutos_pagables,
  coalesce(a.modalidad, c.modalidad) as modalidad,
  ab.full_name as abierta_por_nombre,
  ce.full_name as cerrada_por_nombre,
  a.es_reposicion, a.reposicion_de,
  public.descuento_retardo(a.retardo_min) as descuento_min
from public.asistencias a
join public.clases   c  on c.id  = a.clase_id
join public.profiles p  on p.id  = a.profesor_id
left join public.profiles ab on ab.id = a.abierta_por
left join public.profiles ce on ce.id = a.cerrada_por;

create or replace function public.reporte_horas(p_desde date, p_hasta date)
returns table (
  profesor_id uuid, profesor_nombre text, hourly_rate numeric,
  clases_impartidas bigint, retardos bigint, sin_salida bigint, minutos_pagables bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return query
  select a.profesor_id, p.full_name, p.hourly_rate,
         count(*) filter (where a.salida is not null),
         count(*) filter (where a.retardo_min > public.tolerancia_min()),
         count(*) filter (where a.salida is null),
         coalesce(sum(public.minutos_pagables(a.entrada, a.salida, a.retardo_min,
                        coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin)))
                  filter (where a.salida is not null), 0)::bigint
    from public.asistencias a
    join public.clases   c on c.id = a.clase_id
    join public.profiles p on p.id = a.profesor_id
   where a.fecha between p_desde and p_hasta
   group by a.profesor_id, p.full_name, p.hourly_rate
   order by p.full_name;
end $$;
grant execute on function public.reporte_horas(date, date) to authenticated;

-- ---------- 6. Reportes emitidos: retardos, faltas y reposiciones ----------
alter table public.reportes_horas add column if not exists num_faltas int not null default 0;
alter table public.reportes_horas add column if not exists minutos_descontados int not null default 0;
alter table public.reportes_horas_detalle add column if not exists retardo_min int not null default 0;
alter table public.reportes_horas_detalle add column if not exists descuento_min int not null default 0;
alter table public.reportes_horas_detalle add column if not exists es_reposicion boolean not null default false;
alter table public.reportes_horas_detalle add column if not exists reposicion_de date;

create table if not exists public.reportes_horas_faltas (
  id            bigint generated always as identity primary key,
  reporte_id    uuid not null references public.reportes_horas(id),
  clase_id      uuid not null references public.clases(id),
  fecha         date not null,
  materia       text not null,
  grupo         text not null,
  hora_inicio   time not null,
  hora_fin      time not null,
  repuesta_fecha date
);
create index if not exists reportes_faltas_reporte_idx on public.reportes_horas_faltas (reporte_id);

drop trigger if exists reportes_faltas_inmutable on public.reportes_horas_faltas;
create trigger reportes_faltas_inmutable before update or delete on public.reportes_horas_faltas
  for each row execute function public.trg_reportes_detalle_inmutable();
drop trigger if exists reportes_faltas_inmutable_trunc on public.reportes_horas_faltas;
create trigger reportes_faltas_inmutable_trunc before truncate on public.reportes_horas_faltas
  for each statement execute function public.trg_reportes_detalle_inmutable();

alter table public.reportes_horas_faltas enable row level security;
drop policy if exists reportes_faltas_select on public.reportes_horas_faltas;
create policy reportes_faltas_select on public.reportes_horas_faltas for select to authenticated using (public.es_staff());
revoke all on public.reportes_horas_faltas from anon, authenticated;
grant select on public.reportes_horas_faltas to authenticated;
grant all on public.reportes_horas_faltas to service_role;

drop function if exists public._reporte_candidatas(uuid, date, date, uuid[]);
create function public._reporte_candidatas(
  p_profesor uuid, p_desde date, p_hasta date, p_clases uuid[]
) returns table (
  asistencia_id uuid, clase_id uuid, fecha date, materia text, grupo text, plantel text,
  dia_semana int, hora_inicio time, hora_fin time, minutos int,
  retardo_min int, descuento_min int, es_reposicion boolean, reposicion_de date
) language sql stable security definer set search_path = public as $$
  select a.id, c.id, a.fecha, c.materia, c.grupo, c.plantel,
         extract(isodow from a.fecha)::int,
         coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin),
         public.minutos_pagables(a.entrada, a.salida, a.retardo_min,
              coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin)),
         a.retardo_min, public.descuento_retardo(a.retardo_min), a.es_reposicion, a.reposicion_de
    from public.asistencias a
    join public.clases c on c.id = a.clase_id
   where a.profesor_id = p_profesor
     and a.fecha between p_desde and p_hasta
     and a.clase_id = any (p_clases)
     and a.salida is not null
     and not exists (select 1 from public.reportes_horas_detalle d where d.asistencia_id = a.id and d.activo)
   order by c.materia, c.grupo, a.fecha
$$;

create or replace function public._reporte_faltas(p_profesor uuid, p_desde date, p_hasta date, p_clases uuid[])
returns table (clase_id uuid, fecha date, materia text, grupo text, hora_inicio time, hora_fin time, repuesta_fecha date)
language sql stable security definer set search_path = public as $$
  select f.clase_id, f.fecha, f.materia, f.grupo, f.hora_inicio, f.hora_fin, f.repuesta_fecha
    from public._faltas(p_desde, p_hasta) f
   where f.profesor_id = p_profesor and f.clase_id = any (p_clases)
   order by f.materia, f.grupo, f.fecha
$$;

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
     fecha_emision, cadena_original, sello, serie, emitido_por, emitido_por_nombre, num_faltas, minutos_descontados)
  values
    (v_id, (v_rep->>'folio')::bigint, (v_rep->>'profesor_id')::uuid, v_rep->>'profesor_nombre',
     (v_rep->>'desde')::date, (v_rep->>'hasta')::date, (v_rep->>'tarifa')::numeric,
     (v_rep->>'total_minutos')::int, (v_rep->>'monto')::numeric, (v_rep->>'num_sesiones')::int,
     (v_rep->>'fecha_emision')::timestamptz, v_rep->>'cadena_original', v_rep->>'sello', v_rep->>'serie',
     p_actor, v_nombre, coalesce((v_rep->>'num_faltas')::int, 0), coalesce((v_rep->>'minutos_descontados')::int, 0));

  insert into public.reportes_horas_detalle
    (reporte_id, asistencia_id, clase_id, fecha, materia, grupo, plantel, dia_semana, hora_inicio, hora_fin, minutos,
     retardo_min, descuento_min, es_reposicion, reposicion_de)
  select v_id, (d->>'asistencia_id')::uuid, (d->>'clase_id')::uuid, (d->>'fecha')::date,
         d->>'materia', d->>'grupo', d->>'plantel', (d->>'dia_semana')::smallint,
         (d->>'hora_inicio')::time, (d->>'hora_fin')::time, (d->>'minutos')::int,
         coalesce((d->>'retardo_min')::int, 0), coalesce((d->>'descuento_min')::int, 0),
         coalesce((d->>'es_reposicion')::boolean, false), nullif(d->>'reposicion_de', '')::date
    from jsonb_array_elements(p->'detalle') d;

  insert into public.reportes_horas_faltas
    (reporte_id, clase_id, fecha, materia, grupo, hora_inicio, hora_fin, repuesta_fecha)
  select v_id, (f->>'clase_id')::uuid, (f->>'fecha')::date, f->>'materia', f->>'grupo',
         (f->>'hora_inicio')::time, (f->>'hora_fin')::time, nullif(f->>'repuesta_fecha', '')::date
    from jsonb_array_elements(coalesce(p->'faltas', '[]'::jsonb)) f;

  select coalesce(sum(minutos), 0) into v_suma from public.reportes_horas_detalle where reporte_id = v_id;
  if v_suma <> (v_rep->>'total_minutos')::bigint
     or (select count(*) from public.reportes_horas_detalle where reporte_id = v_id) <> (v_rep->>'num_sesiones')::int
     or (select count(*) from public.reportes_horas_faltas where reporte_id = v_id) <> coalesce((v_rep->>'num_faltas')::int, 0) then
    raise exception 'El detalle no coincide con el total del reporte';
  end if;

  perform public.log_bitacora(p_actor, 'reporte.emitir', 'reporte', v_id::text,
    format('Emitió el reporte de horas folio %s de %s (%s al %s): %s h, $%s, %s falta(s)',
           v_rep->>'folio', v_rep->>'profesor_nombre', v_rep->>'desde', v_rep->>'hasta',
           to_char((v_rep->>'total_minutos')::numeric / 60, 'FM990.00'),
           to_char((v_rep->>'monto')::numeric, 'FM999,999,990.00'),
           coalesce(v_rep->>'num_faltas', '0')),
    jsonb_build_object('folio', (v_rep->>'folio')::bigint, 'profesor_id', v_rep->>'profesor_id',
                       'sesiones', (v_rep->>'num_sesiones')::int));
  return v_id;
exception when unique_violation then
  raise exception 'Alguna de las clases ya fue incluida en otro reporte vigente';
end $$;

revoke all on function public._reporte_candidatas(uuid, date, date, uuid[]) from public, anon, authenticated;
revoke all on function public._reporte_faltas(uuid, date, date, uuid[])     from public, anon, authenticated;
revoke all on function public._reporte_guardar(jsonb, uuid)                 from public, anon, authenticated;
grant execute on function public._reporte_candidatas(uuid, date, date, uuid[]) to service_role;
grant execute on function public._reporte_faltas(uuid, date, date, uuid[])     to service_role;
grant execute on function public._reporte_guardar(jsonb, uuid)                 to service_role;

-- Panel por clase (casillas): ahora con descuentos por retardo y faltas
drop function if exists public.reporte_horas_clases(date, date);
create function public.reporte_horas_clases(p_desde date, p_hasta date)
returns table (
  profesor_id uuid, clase_id uuid, materia text, grupo text, plantel text, modalidad text,
  dia_semana int, hora_inicio time, hora_fin time,
  sesiones_pendientes bigint, minutos_pendientes bigint,
  sesiones_reportadas bigint, minutos_reportados bigint,
  sin_salida bigint, folios text,
  minutos_descontados bigint, faltas bigint, faltas_repuestas bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return query
  with s as (
    select a.id, a.clase_id, a.salida,
           public.minutos_pagables(a.entrada, a.salida, a.retardo_min,
              coalesce(a.prog_inicio, c.hora_inicio), coalesce(a.prog_fin, c.hora_fin)) as min_pag,
           public.descuento_retardo(a.retardo_min) as desc_min,
           (select r.folio from public.reportes_horas_detalle d
              join public.reportes_horas r on r.id = d.reporte_id
             where d.asistencia_id = a.id and d.activo limit 1) as folio
      from public.asistencias a
      join public.clases c on c.id = a.clase_id
     where a.fecha between p_desde and p_hasta
  ),
  sa as (
    select s.clase_id,
           count(*) filter (where s.salida is not null and s.folio is null) as sp,
           coalesce(sum(s.min_pag) filter (where s.salida is not null and s.folio is null), 0) as mp,
           count(*) filter (where s.folio is not null) as sr,
           coalesce(sum(s.min_pag) filter (where s.folio is not null), 0) as mr,
           count(*) filter (where s.salida is null) as ss,
           string_agg(distinct s.folio::text, ', ') as fol,
           coalesce(sum(s.desc_min) filter (where s.salida is not null and s.folio is null), 0) as md
      from s group by s.clase_id
  ),
  fa as (
    select f.clase_id, count(*) as nf, count(*) filter (where f.repuesta_fecha is not null) as nr
      from public._faltas(p_desde, p_hasta) f group by f.clase_id
  )
  select c.profesor_id, c.id, c.materia, c.grupo, c.plantel, c.modalidad, c.dia_semana::int,
         c.hora_inicio, c.hora_fin,
         coalesce(sa.sp, 0), coalesce(sa.mp, 0)::bigint, coalesce(sa.sr, 0), coalesce(sa.mr, 0)::bigint,
         coalesce(sa.ss, 0), sa.fol, coalesce(sa.md, 0)::bigint, coalesce(fa.nf, 0), coalesce(fa.nr, 0)
    from public.clases c
    left join sa on sa.clase_id = c.id
    left join fa on fa.clase_id = c.id
   where sa.clase_id is not null or fa.clase_id is not null
   order by c.materia, c.grupo;
end $$;
revoke execute on function public.reporte_horas_clases(date, date) from public, anon;
grant  execute on function public.reporte_horas_clases(date, date) to authenticated;
