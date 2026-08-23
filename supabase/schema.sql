-- =============================================================
-- SOKUGAN 端末間同期 — テーブル定義と Row Level Security
-- =============================================================
-- 実行方法: Supabase ダッシュボード > SQL Editor にこのファイルの全文を貼って Run。
-- 冪等（何度実行しても同じ結果）に書いてあるので、作り直しや再実行も安全。
--
-- 設計方針:
--   ・学習状態は「1ユーザー1行」の JSONB で保持する。マージはクライアント側で
--     フィールド別の決定論ルールで行う（index.html の mergeStates）。
--     サーバ側でマージしないのは、オフライン中に両端末で進んだ差分を
--     ラウンドトリップ1回で解決するため。
--   ・rev による楽観的排他。PATCH は「読んだ時の rev」と一致する行だけ更新する。
--     一致しなければ0行更新となり、クライアントは再pull→再マージして再試行する。
--     これが「端末Aの更新が端末Bに上書きされる」事故を構造的に防ぐ。
--   ・RLS により、認証済みユーザーは自分の user_id の行しか触れない。

create table if not exists public.sokugan_state (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  state      jsonb       not null default '{}'::jsonb,
  rev        bigint      not null default 1,
  device_id  text,
  updated_at timestamptz not null default now()
);

comment on table  public.sokugan_state is 'SOKUGAN 学習状態（1ユーザー1行）。マージはクライアント側で実施。';
comment on column public.sokugan_state.rev is '楽観的排他用のリビジョン。更新ごとに+1する。';

-- ---------- Row Level Security ----------
alter table public.sokugan_state enable row level security;

-- 再実行を安全にするため、同名ポリシーを作り直す
drop policy if exists "sokugan_state_select_own" on public.sokugan_state;
drop policy if exists "sokugan_state_insert_own" on public.sokugan_state;
drop policy if exists "sokugan_state_update_own" on public.sokugan_state;
drop policy if exists "sokugan_state_delete_own" on public.sokugan_state;

create policy "sokugan_state_select_own"
  on public.sokugan_state for select
  using (auth.uid() = user_id);

create policy "sokugan_state_insert_own"
  on public.sokugan_state for insert
  with check (auth.uid() = user_id);

create policy "sokugan_state_update_own"
  on public.sokugan_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sokugan_state_delete_own"
  on public.sokugan_state for delete
  using (auth.uid() = user_id);

-- anon（未ログイン）には一切触らせない。認証済みのみ。
revoke all on public.sokugan_state from anon;
grant select, insert, update, delete on public.sokugan_state to authenticated;

-- ---------- updated_at の自動更新 ----------
create or replace function public.sokugan_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sokugan_state_touch on public.sokugan_state;
create trigger sokugan_state_touch
  before update on public.sokugan_state
  for each row execute function public.sokugan_touch_updated_at();

-- ---------- 確認 ----------
-- 期待: rowsecurity = true、ポリシー4件
--   select relname, relrowsecurity from pg_class where relname = 'sokugan_state';
--   select policyname, cmd from pg_policies where tablename = 'sokugan_state';
