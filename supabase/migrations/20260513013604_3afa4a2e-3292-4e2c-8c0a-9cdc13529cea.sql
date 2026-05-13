
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  rental_id text,
  stripe_subscription_id text unique,
  stripe_customer_id text not null,
  stripe_session_id text,
  product_id text,
  price_id text,
  kind text not null default 'subscription', -- 'subscription' | 'deposit'
  amount_cents integer,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  environment text not null default 'sandbox',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_stripe_id on public.subscriptions(stripe_subscription_id);
create index idx_subscriptions_rental on public.subscriptions(rental_id);

alter table public.subscriptions enable row level security;

create policy "Users view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Admins view all subscriptions"
  on public.subscriptions for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Service role manages subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role');

create trigger touch_subscriptions
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
