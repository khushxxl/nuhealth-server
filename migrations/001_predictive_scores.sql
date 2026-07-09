-- Predictive Insights: daily per-user scores produced by the Biyo scoring engine
-- (services/scoring). One row per (user, day, score type). Populated by the
-- twice-daily reconcile-style cron for users who are Pro AND have >= 12 scans.
--
-- Lifestyle's composite pillar needs the prior daily scores of the other five,
-- so we keep the full daily history here rather than only "latest".
--
-- Read exclusively through biyo-server (service role). RLS is enabled with NO
-- policies, so the anon/auth client cannot read it directly — matching the
-- project rule that all fetching goes through the server.

create table if not exists public.predictive_scores (
  user_id           uuid    not null references public.users(id) on delete cascade,
  score_date        date    not null,
  score_type        text    not null check (score_type in
                      ('heart','movement','weight','mind','oxygen','lifestyle')),
  score             numeric,            -- 0-100; null when no pillar had data
  confidence        numeric,            -- 0.0-1.0 share of pillar weight that contributed
  status_chip       text,               -- null for the heart score (it has none)
  baseline_status   text,               -- cold_start | trend_ready | full
  data_sources_used text[]  not null default '{}',
  payload           jsonb   not null,   -- full engine result (pillars breakdown, etc.)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, score_date, score_type)
);

-- Fast "latest scores for a user" and "last N days trend" lookups.
create index if not exists predictive_scores_user_date_idx
  on public.predictive_scores (user_id, score_date desc);

alter table public.predictive_scores enable row level security;
-- No policies on purpose: only the service role (biyo-server) may read/write.
