-- BOIN cloud workspace schema for Supabase.
-- Run in Supabase SQL Editor. RLS ensures users can only read/write their own workspace.
create table if not exists public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_workspaces enable row level security;

drop policy if exists "Users can read their own BOIN workspace" on public.user_workspaces;
create policy "Users can read their own BOIN workspace"
  on public.user_workspaces for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own BOIN workspace" on public.user_workspaces;
create policy "Users can insert their own BOIN workspace"
  on public.user_workspaces for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own BOIN workspace" on public.user_workspaces;
create policy "Users can update their own BOIN workspace"
  on public.user_workspaces for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own BOIN workspace" on public.user_workspaces;
create policy "Users can delete their own BOIN workspace"
  on public.user_workspaces for delete
  to authenticated
  using (auth.uid() = user_id);

-- Keep privileges explicit. Supabase's authenticated role can use the table,
-- but row-level policies limit every row to its owning user.
grant select, insert, update, delete on public.user_workspaces to authenticated;
revoke all on public.user_workspaces from anon;
