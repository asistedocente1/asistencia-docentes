-- =====================================================================
-- MIGRACIÓN 02 · PASO B  (ejecutar DESPUÉS del paso A)
--
-- Agrega:
--   · modalidad de la clase (presencial / en línea)
--   · bitácora de acciones (visible solo para super_admin y admin)
--   · apertura y cierre de clases desde el módulo "Apertura de clases"
--   · "foto de lo programado": las asistencias guardan el horario vigente al
--     registrarse, así editar una clase NO cambia el pago de lo ya registrado
--
-- Es seguro ejecutarla más de una vez. No borra datos.
-- Supabase > SQL Editor > New query > pegar todo > Run.
-- =====================================================================

-- ---------- 1. Modalidad de la clase ----------
alter table public.clases add column if not exists modalidad text not null default 'presencial';
do $$ begin
  alter table public.clases
    add constraint clases_modalidad_chk check (modalidad in ('presencial','en_linea'));
exception when duplicate_object then null; end $$;

-- ---------- 2. Asistencias: horario vigente al registrar + quién abrió/cerró ----------
alter table public.asistencias
  add column if not exists prog_inicio time,
  add column if not exists prog_fin    time,
  add column if not exists modalidad   text,
  add column if not exists abierta_por uuid references public.profiles(id),
  add column if not exists cerrada_por uuid references public.profiles(id);

update public.asistencias a
   set prog_inicio = c.hora_inicio,
       prog_fin    = c.hora_fin,
       modalidad   = c.modalidad
  from public.clases c
 where c.id = a.clase_id and a.prog_inicio is null;

update public.asistencias set abierta_por = profesor_id where abierta_por is null;
update public.asistencias set cerrada_por = profesor_id where cerrada_por is null and salida is not null;

-- ---------- 3. Bitácora ----------
create table if not exists public.bitacora (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_nombre text,
  actor_rol   text,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  resumen     text,
  detalle     jsonb
);
create index if not exists bitacora_fecha_idx  on public.bitacora (created_at desc);
create index if not exists bitacora_actor_idx  on public.bitacora (actor_id, created_at desc);
create index if not exists bitacora_accion_idx on public.bitacora (accion, entidad_id, created_at desc);

alter table public.bitacora enable row level security;

drop policy if exists bitacora_select on public.bitacora;
create policy bitacora_select on public.bitacora for select to authenticated
  using (public.es_gestor());          -- solo super_admin y admin
-- Sin políticas de escritura: nadie puede insertar, editar ni borrar desde la app.
revoke all on public.bitacora from anon;
revoke insert, update, delete, truncate on public.bitacora from authenticated;
grant select on public.bitacora to authenticated;
grant all    on public.bitacora to service_role;

-- Escribe en la bitácora (solo uso interno: funciones del sistema y API del servidor)
create or replace function public.log_bitacora(
  p_actor uuid, p_accion text, p_entidad text, p_entidad_id text, p_resumen text, p_detalle jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_nombre text; v_rol text;
begin
  select full_name, role::text into v_nombre, v_rol from public.profiles where id = p_actor;
  insert into public.bitacora (actor_id, actor_nombre, actor_rol, accion, entidad, entidad_id, resumen, detalle)
  values (p_actor, v_nombre, v_rol, p_accion, p_entidad, p_entidad_id, p_resumen, p_detalle);
end $$;
revoke all on function public.log_bitacora(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_bitacora(uuid, text, text, text, text, jsonb) to service_role;

-- Inicio de sesión (lo llama la pantalla de login)
create or replace function public.registrar_login()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public.log_bitacora(auth.uid(), 'sesion.inicio', 'sesion', auth.uid()::text, 'Inició sesión', null);
end $$;
revoke execute on function public.registrar_login() from public, anon;
grant  execute on function public.registrar_login() to authenticated;

-- Cambios en clases (alta, edición, baja) con quién los hizo
create or replace function public.trg_clases_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dias text[] := array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  v_cambios jsonb;
  v_prof text;
  v_campos text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_prof from public.profiles where id = new.profesor_id;
    perform public.log_bitacora(auth.uid(), 'clase.crear', 'clase', new.id::text,
      format('Creó la clase %s (%s) de %s: %s %s–%s, %s, %s',
             new.materia, new.grupo, coalesce(v_prof, '—'), v_dias[new.dia_semana],
             to_char(new.hora_inicio, 'HH24:MI'), to_char(new.hora_fin, 'HH24:MI'),
             new.plantel, case when new.modalidad = 'en_linea' then 'en línea' else 'presencial' end),
      null);
    return new;

  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb)
      into v_cambios
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'created_at';

    if v_cambios = '{}'::jsonb then return new; end if;

    if v_cambios ? 'profesor_id' then
      v_cambios := (v_cambios - 'profesor_id') || jsonb_build_object('profesor', jsonb_build_object(
        'antes',   (select full_name from public.profiles where id = old.profesor_id),
        'despues', (select full_name from public.profiles where id = new.profesor_id)));
    end if;
    if v_cambios ? 'dia_semana' then
      v_cambios := (v_cambios - 'dia_semana') || jsonb_build_object('dia', jsonb_build_object(
        'antes', v_dias[old.dia_semana], 'despues', v_dias[new.dia_semana]));
    end if;

    if v_cambios ? 'activo' and (select count(*) from jsonb_object_keys(v_cambios)) = 1 then
      perform public.log_bitacora(auth.uid(),
        case when new.activo then 'clase.activar' else 'clase.desactivar' end, 'clase', new.id::text,
        format('%s la clase %s (%s)', case when new.activo then 'Activó' else 'Desactivó' end, new.materia, new.grupo),
        v_cambios);
    else
      select string_agg(k, ', ') into v_campos from jsonb_object_keys(v_cambios) k;
      perform public.log_bitacora(auth.uid(), 'clase.editar', 'clase', new.id::text,
        format('Editó la clase %s (%s): %s', new.materia, new.grupo, v_campos), v_cambios);
    end if;
    return new;

  else -- DELETE
    perform public.log_bitacora(auth.uid(), 'clase.eliminar', 'clase', old.id::text,
      format('Eliminó la clase %s (%s)', old.materia, old.grupo), to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists clases_bitacora on public.clases;
create trigger clases_bitacora after insert or update or delete on public.clases
  for each row execute function public.trg_clases_bitacora();

-- ---------- 4. Apertura / cierre de clases (lógica central) ----------
-- Funciones internas: NO las puede llamar un usuario directamente.
-- Las usan las funciones de abajo (clases presenciales) y la API del servidor
-- (clases en línea, después de comprobar la contraseña del profesor).
create or replace function public._abrir_clase(p_clase_id uuid, p_actor uuid, p_metodo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clase   public.clases%rowtype;
  v_local   timestamp := (now() at time zone 'America/Mexico_City');
  v_id      uuid;
  v_retardo int;
  v_prof    text;
begin
  select * into v_clase from public.clases where id = p_clase_id and activo;
  if not found then raise exception 'Clase no encontrada o inactiva'; end if;

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

  insert into public.asistencias
    (clase_id, profesor_id, fecha, entrada, retardo_min, prog_inicio, prog_fin, modalidad, abierta_por)
  values
    (v_clase.id, v_clase.profesor_id, v_local::date, now(), v_retardo,
     v_clase.hora_inicio, v_clase.hora_fin, v_clase.modalidad, p_actor)
  returning id into v_id;

  select full_name into v_prof from public.profiles where id = v_clase.profesor_id;
  perform public.log_bitacora(p_actor, 'clase.abrir', 'asistencia', v_id::text,
    format('Abrió la clase %s (%s) de %s [%s]', v_clase.materia, v_clase.grupo, coalesce(v_prof, '—'), p_metodo),
    jsonb_build_object('clase_id', v_clase.id, 'profesor_id', v_clase.profesor_id,
                       'metodo', p_metodo, 'retardo_min', v_retardo));
  return v_id;
exception when unique_violation then
  raise exception 'Esta clase ya fue abierta hoy';
end $$;

create or replace function public._cerrar_clase(p_clase_id uuid, p_actor uuid, p_metodo text)
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
  returning id into v_id;
  if v_id is null then raise exception 'No hay una clase abierta para cerrar'; end if;

  select * into v_clase from public.clases where id = p_clase_id;
  select full_name into v_prof from public.profiles where id = v_clase.profesor_id;
  perform public.log_bitacora(p_actor, 'clase.cerrar', 'asistencia', v_id::text,
    format('Registró la salida de la clase %s (%s) de %s [%s]', v_clase.materia, v_clase.grupo, coalesce(v_prof, '—'), p_metodo),
    jsonb_build_object('clase_id', p_clase_id, 'profesor_id', v_clase.profesor_id, 'metodo', p_metodo));
  return v_id;
end $$;

revoke all on function public._abrir_clase(uuid, uuid, text)  from public, anon, authenticated;
revoke all on function public._cerrar_clase(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public._abrir_clase(uuid, uuid, text)  to service_role;
grant execute on function public._cerrar_clase(uuid, uuid, text) to service_role;

-- Clases PRESENCIALES: las abre/cierra directamente el personal autorizado
create or replace function public.abrir_clase(p_clase_id uuid)
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
  return public._abrir_clase(p_clase_id, auth.uid(), 'presencial');
end $$;

create or replace function public.cerrar_clase(p_clase_id uuid)
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
  return public._cerrar_clase(p_clase_id, auth.uid(), 'presencial');
end $$;

-- Foto tomada por quien abrió/cerró la clase desde el módulo de apertura
create or replace function public.adjuntar_foto_apertura(p_asistencia_id uuid, p_tipo text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso';
  end if;
  if p_tipo not in ('entrada','salida') then raise exception 'Tipo inválido'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Ruta inválida'; end if;

  if p_tipo = 'entrada' then
    update public.asistencias set foto_entrada = p_path
     where id = p_asistencia_id and abierta_por = auth.uid() and foto_entrada is null;
  else
    update public.asistencias set foto_salida = p_path
     where id = p_asistencia_id and cerrada_por = auth.uid() and foto_salida is null;
  end if;
  if not found then raise exception 'No se pudo adjuntar la foto'; end if;
end $$;

-- Clases del día con su estado (para los recuadros de "Apertura de clases").
-- Devuelve también la hora del servidor para no depender del reloj del equipo.
create or replace function public.apertura_del_dia()
returns table (
  clase_id uuid, materia text, grupo text, plantel text, modalidad text,
  hora_inicio time, hora_fin time, profesor_id uuid, profesor_nombre text,
  asistencia_id uuid, entrada timestamptz, salida timestamptz, retardo_min int, ahora time
)
language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := (now() at time zone 'America/Mexico_City');
begin
  if public.mi_rol() is null or public.mi_rol() not in ('super_admin','admin','apertura') then
    raise exception 'Sin permiso';
  end if;
  return query
  select c.id, c.materia, c.grupo, c.plantel, c.modalidad,
         c.hora_inicio, c.hora_fin, c.profesor_id, p.full_name,
         a.id, a.entrada, a.salida, a.retardo_min, v_local::time
    from public.clases c
    join public.profiles p on p.id = c.profesor_id and p.active
    left join public.asistencias a on a.clase_id = c.id and a.fecha = v_local::date
   where c.activo and c.dia_semana = extract(isodow from v_local)::int
   order by c.hora_inicio, p.full_name;
end $$;

revoke execute on function public.abrir_clase(uuid)                       from public, anon;
revoke execute on function public.cerrar_clase(uuid)                      from public, anon;
revoke execute on function public.adjuntar_foto_apertura(uuid, text, text) from public, anon;
revoke execute on function public.apertura_del_dia()                      from public, anon;
grant  execute on function public.abrir_clase(uuid)                       to authenticated;
grant  execute on function public.cerrar_clase(uuid)                      to authenticated;
grant  execute on function public.adjuntar_foto_apertura(uuid, text, text) to authenticated;
grant  execute on function public.apertura_del_dia()                      to authenticated;

-- ---------- 5. Registro del propio profesor (Mi asistencia): ahora con bitácora y horario vigente ----------
create or replace function public.registrar_entrada(p_clase_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'profesor' then
    raise exception 'Solo los profesores pueden registrar asistencia';
  end if;
  if not exists (select 1 from public.clases where id = p_clase_id and profesor_id = auth.uid() and activo) then
    raise exception 'Clase no encontrada';
  end if;
  return public._abrir_clase(p_clase_id, auth.uid(), 'profesor');
end $$;

create or replace function public.registrar_salida(p_asistencia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'profesor' then
    raise exception 'Solo los profesores pueden registrar asistencia';
  end if;
  update public.asistencias set salida = now(), cerrada_por = auth.uid()
   where id = p_asistencia_id and profesor_id = auth.uid() and salida is null;
  if not found then raise exception 'No hay una entrada abierta para cerrar'; end if;
  perform public.log_bitacora(auth.uid(), 'clase.cerrar', 'asistencia', p_asistencia_id::text,
    'Registró su salida [profesor]', jsonb_build_object('metodo', 'profesor'));
end $$;

-- ---------- 6. Vistas y reportes (usan el horario vigente al registrar) ----------
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
  case when a.salida is not null
       then least(floor(extract(epoch from (a.salida - a.entrada)) / 60)::int,
                  (extract(epoch from (coalesce(a.prog_fin, c.hora_fin) - coalesce(a.prog_inicio, c.hora_inicio))) / 60)::int)
       end as minutos_pagables,
  coalesce(a.modalidad, c.modalidad) as modalidad,
  ab.full_name as abierta_por_nombre,
  ce.full_name as cerrada_por_nombre
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
         count(*) filter (where a.retardo_min > 0),
         count(*) filter (where a.salida is null),
         coalesce(sum(least(floor(extract(epoch from (a.salida - a.entrada)) / 60)::int,
                            (extract(epoch from (coalesce(a.prog_fin, c.hora_fin) - coalesce(a.prog_inicio, c.hora_inicio))) / 60)::int))
                  filter (where a.salida is not null), 0)::bigint
    from public.asistencias a
    join public.clases   c on c.id = a.clase_id
    join public.profiles p on p.id = a.profesor_id
   where a.fecha between p_desde and p_hasta
   group by a.profesor_id, p.full_name, p.hourly_rate
   order by p.full_name;
end $$;

create or replace function public.reporte_faltas(p_desde date, p_hasta date)
returns table (
  fecha date, profesor_id uuid, profesor_nombre text, materia text, grupo text,
  plantel text, hora_inicio time, hora_fin time
)
language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := (now() at time zone 'America/Mexico_City');
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return query
  select d::date, c.profesor_id, p.full_name, c.materia, c.grupo, c.plantel, c.hora_inicio, c.hora_fin
    from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d
    join public.clases   c on c.activo and c.dia_semana = extract(isodow from d)::int
                           and (c.created_at at time zone 'America/Mexico_City')::date <= d::date
    join public.profiles p on p.id = c.profesor_id
    left join public.asistencias a on a.clase_id = c.id and a.fecha = d::date
   where a.id is null
     and (d::date < v_local::date or (d::date = v_local::date and c.hora_fin <= v_local::time))
   order by 1, 4;
end $$;

grant execute on function public.reporte_horas(date, date)  to authenticated;
grant execute on function public.reporte_faltas(date, date) to authenticated;
