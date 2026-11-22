-- =====================================================================
-- CUEJ · Sistema de asistencia docente · Esquema de Supabase
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Roles ----------
do $$ begin
  create type public.app_role as enum ('super_admin','admin','profesor','control_escolar');
exception when duplicate_object then null; end $$;

-- ---------- Tablas ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        public.app_role not null,
  active      boolean not null default true,
  hourly_rate numeric(10,2) not null default 0,   -- pago por hora (solo profesores)
  created_at  timestamptz not null default now()
);

create table if not exists public.clases (
  id          uuid primary key default gen_random_uuid(),
  profesor_id uuid not null references public.profiles(id) on delete cascade,
  materia     text not null,
  grupo       text not null,
  plantel     text not null default 'Ciudad de México',
  dia_semana  smallint not null check (dia_semana between 1 and 7), -- 1=lunes ... 7=domingo
  hora_inicio time not null,
  hora_fin    time not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

create table if not exists public.asistencias (
  id            uuid primary key default gen_random_uuid(),
  clase_id      uuid not null references public.clases(id),
  profesor_id   uuid not null references public.profiles(id),
  fecha         date not null,
  entrada       timestamptz not null,
  salida        timestamptz,
  foto_entrada  text,
  foto_salida   text,
  retardo_min   int not null default 0,
  created_at    timestamptz not null default now(),
  unique (clase_id, fecha)
);

create index if not exists asistencias_fecha_idx on public.asistencias (fecha);
create index if not exists asistencias_profesor_idx on public.asistencias (profesor_id, fecha);
create index if not exists clases_profesor_idx on public.clases (profesor_id);

-- ---------- Funciones auxiliares de rol ----------
create or replace function public.mi_rol()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.es_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('super_admin','admin','control_escolar'), false)
$$;

create or replace function public.es_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('super_admin','admin'), false)
$$;

-- ---------- Row Level Security ----------
alter table public.profiles    enable row level security;
alter table public.clases      enable row level security;
alter table public.asistencias enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.es_staff());
-- Altas/cambios de usuarios: solo vía API del servidor (service role).

drop policy if exists clases_select on public.clases;
create policy clases_select on public.clases for select to authenticated
  using (profesor_id = auth.uid() or public.es_staff());

drop policy if exists clases_gestion on public.clases;
create policy clases_gestion on public.clases for all to authenticated
  using (public.es_gestor()) with check (public.es_gestor());

drop policy if exists asistencias_select on public.asistencias;
create policy asistencias_select on public.asistencias for select to authenticated
  using (profesor_id = auth.uid() or public.es_staff());
-- Sin políticas de escritura: las asistencias solo se crean con las funciones de abajo.

-- ---------- Registro de entrada / salida (la hora la pone el SERVIDOR) ----------
create or replace function public.registrar_entrada(p_clase_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clase   public.clases%rowtype;
  v_local   timestamp := (now() at time zone 'America/Mexico_City');
  v_id      uuid;
  v_retardo int;
begin
  if public.mi_rol() is distinct from 'profesor' then
    raise exception 'Solo los profesores pueden registrar asistencia';
  end if;

  select * into v_clase from public.clases
   where id = p_clase_id and profesor_id = auth.uid() and activo;
  if not found then raise exception 'Clase no encontrada'; end if;

  if extract(isodow from v_local)::int <> v_clase.dia_semana then
    raise exception 'Esta clase no corresponde al día de hoy';
  end if;
  if v_local::time < (v_clase.hora_inicio - interval '30 minutes') then
    raise exception 'Aún no puedes registrar entrada (se habilita 30 min antes del inicio)';
  end if;
  if v_local::time >= v_clase.hora_fin then
    raise exception 'La clase ya terminó';
  end if;

  v_retardo := greatest(0, floor(extract(epoch from (v_local::time - v_clase.hora_inicio)) / 60))::int;

  insert into public.asistencias (clase_id, profesor_id, fecha, entrada, retardo_min)
  values (v_clase.id, auth.uid(), v_local::date, now(), v_retardo)
  returning id into v_id;

  return v_id;
exception when unique_violation then
  raise exception 'Ya registraste tu entrada para esta clase hoy';
end $$;

create or replace function public.registrar_salida(p_asistencia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'profesor' then
    raise exception 'Solo los profesores pueden registrar asistencia';
  end if;
  update public.asistencias set salida = now()
   where id = p_asistencia_id and profesor_id = auth.uid() and salida is null;
  if not found then raise exception 'No hay una entrada abierta para cerrar'; end if;
end $$;

create or replace function public.adjuntar_foto(p_asistencia_id uuid, p_tipo text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tipo not in ('entrada','salida') then raise exception 'Tipo inválido'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Ruta inválida'; end if;
  if p_tipo = 'entrada' then
    update public.asistencias set foto_entrada = p_path
     where id = p_asistencia_id and profesor_id = auth.uid();
  else
    update public.asistencias set foto_salida = p_path
     where id = p_asistencia_id and profesor_id = auth.uid();
  end if;
end $$;

grant execute on function public.registrar_entrada(uuid)            to authenticated;
grant execute on function public.registrar_salida(uuid)             to authenticated;
grant execute on function public.adjuntar_foto(uuid, text, text)    to authenticated;

-- ---------- Vista con horas calculadas ----------
-- minutos_pagables = minutos entre entrada y salida, sin pasar de lo programado.
create or replace view public.asistencias_detalle with (security_invoker = true) as
select
  a.id, a.fecha, a.profesor_id,
  p.full_name  as profesor_nombre,
  p.hourly_rate,
  c.materia, c.grupo, c.plantel, c.hora_inicio, c.hora_fin,
  a.entrada, a.salida, a.retardo_min, a.foto_entrada, a.foto_salida,
  (extract(epoch from (c.hora_fin - c.hora_inicio)) / 60)::int as minutos_programados,
  case when a.salida is not null
       then floor(extract(epoch from (a.salida - a.entrada)) / 60)::int end as minutos_trabajados,
  case when a.salida is not null
       then least(floor(extract(epoch from (a.salida - a.entrada)) / 60)::int,
                  (extract(epoch from (c.hora_fin - c.hora_inicio)) / 60)::int) end as minutos_pagables
from public.asistencias a
join public.clases   c on c.id = a.clase_id
join public.profiles p on p.id = a.profesor_id;

-- ---------- Reporte de horas por profesor (para pago) ----------
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
                            (extract(epoch from (c.hora_fin - c.hora_inicio)) / 60)::int))
                  filter (where a.salida is not null), 0)::bigint
    from public.asistencias a
    join public.clases   c on c.id = a.clase_id
    join public.profiles p on p.id = a.profesor_id
   where a.fecha between p_desde and p_hasta
   group by a.profesor_id, p.full_name, p.hourly_rate
   order by p.full_name;
end $$;

-- ---------- Faltas: clases programadas sin ningún registro ----------
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
                           and c.created_at::date <= d::date
    join public.profiles p on p.id = c.profesor_id
    left join public.asistencias a on a.clase_id = c.id and a.fecha = d::date
   where a.id is null
     and (d::date < v_local::date or (d::date = v_local::date and c.hora_fin <= v_local::time))
   order by 1, 4;
end $$;

grant execute on function public.reporte_horas(date, date)  to authenticated;
grant execute on function public.reporte_faltas(date, date) to authenticated;

-- ---------- Storage: fotos de asistencia (bucket privado) ----------
insert into storage.buckets (id, name, public)
values ('asistencia-fotos', 'asistencia-fotos', false)
on conflict (id) do nothing;

drop policy if exists "profesor sube su foto" on storage.objects;
create policy "profesor sube su foto" on storage.objects for insert to authenticated
  with check (bucket_id = 'asistencia-fotos'
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "staff ve fotos" on storage.objects;
create policy "staff ve fotos" on storage.objects for select to authenticated
  using (bucket_id = 'asistencia-fotos' and public.es_staff());

-- ---------- Primer Super administrador ----------
-- 1) Crea el usuario en Supabase > Authentication > Users > Add user (con correo y contraseña).
-- 2) Ejecuta esto con SU correo:
--
-- insert into public.profiles (id, full_name, email, role)
-- select id, 'Raúl Trejo', email, 'super_admin' from auth.users
--  where email = 'TU_CORREO@cuej.edu.mx';
