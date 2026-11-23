-- Initial PostgreSQL schema for an independent brief application.

CREATE TABLE public.article_screenings (
    article_id uuid NOT NULL,
    input_key text NOT NULL,
    batch_key text NOT NULL,
    batch_size integer NOT NULL,
    member_index integer NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    fallback boolean DEFAULT false NOT NULL,
    call_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT article_screenings_batch_size_check CHECK (((batch_size >= 1) AND (batch_size <= 20))),
    CONSTRAINT article_screenings_check CHECK (((member_index >= 0) AND (member_index < batch_size))),
    CONSTRAINT article_screenings_decision_check CHECK ((decision = ANY (ARRAY['PASS'::text, 'BLOCK'::text, 'UNCERTAIN'::text])))
);

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid,
    source_name text NOT NULL,
    industry_id text NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    excerpt text NOT NULL,
    published_at timestamp with time zone NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_precision text DEFAULT 'time'::text NOT NULL,
    provenance jsonb,
    processing_version text,
    input_hash text,
    facts jsonb,
    score_reason text,
    review_note text,
    assessment jsonb,
    CONSTRAINT articles_published_precision_check CHECK ((published_precision = ANY (ARRAY['time'::text, 'day'::text, 'observed'::text]))),
    CONSTRAINT articles_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'processed'::text, 'ignored'::text, 'failed'::text])))
);

CREATE TABLE public.brief_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    period_date date NOT NULL,
    range_start timestamp with time zone NOT NULL,
    range_end timestamp with time zone NOT NULL,
    force boolean DEFAULT false NOT NULL,
    expected_key text,
    state text DEFAULT 'waiting'::text NOT NULL,
    job_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT brief_requests_kind_check CHECK ((kind = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT brief_requests_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'queued'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE public.briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    period_date date NOT NULL,
    draft jsonb,
    published jsonb,
    generated_at timestamp with time zone,
    published_at timestamp with time zone,
    issue_number integer,
    auto_mail boolean DEFAULT true NOT NULL,
    CONSTRAINT briefs_issue_number_check CHECK ((issue_number > 0)),
    CONSTRAINT briefs_kind_check CHECK ((kind = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
);

CREATE TABLE public.collection_items (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    source_id uuid NOT NULL,
    title text NOT NULL,
    url text,
    published_at timestamp with time zone,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome text NOT NULL,
    CONSTRAINT collection_items_outcome_check CHECK ((outcome = ANY (ARRAY['new'::text, 'known'::text, 'repeated'::text, 'outside_window'::text, 'invalid'::text, 'failed'::text])))
);

ALTER TABLE public.collection_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.collection_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.collection_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid,
    source_name text NOT NULL,
    url text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    state text DEFAULT 'running'::text NOT NULL,
    result jsonb,
    error text
);

CREATE TABLE public.deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brief_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deliveries_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'uncertain'::text])))
);

CREATE TABLE public.edition_runs (
    period_date date NOT NULL,
    section text NOT NULL,
    status text NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    selected_count integer DEFAULT 0 NOT NULL,
    reason text NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    details jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT edition_runs_status_check CHECK ((status = ANY (ARRAY['unscheduled'::text, 'skipped'::text, 'error'::text, 'published'::text, 'ready'::text, 'blocked'::text])))
);

CREATE TABLE public.event_developments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    article_id uuid NOT NULL,
    fact_hash text NOT NULL,
    facts jsonb NOT NULL,
    happened_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    editorial jsonb
);

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    industry_id text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    section text NOT NULL,
    score integer NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assessment jsonb,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT events_score_check CHECK (((score >= 0) AND (score <= 100)))
);

CREATE TABLE public.industries (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    sections jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.login_attempts (
    key text NOT NULL,
    count integer NOT NULL,
    reset_at timestamp with time zone NOT NULL
);

CREATE TABLE public.mail_send_runtime (
    connection_key text NOT NULL,
    next_send_at timestamp with time zone DEFAULT now() NOT NULL,
    cooldown_until timestamp with time zone
);

CREATE TABLE public.model_attempts (
    id bigint NOT NULL,
    call_id uuid,
    model_config_id text NOT NULL,
    model_name text NOT NULL,
    provider_model text NOT NULL,
    kind text DEFAULT 'call'::text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    api_attempts integer DEFAULT 1 NOT NULL,
    state text DEFAULT 'started'::text NOT NULL,
    error_category text,
    http_status integer,
    error text,
    input_tokens integer,
    output_tokens integer,
    latency_ms integer,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT model_attempts_api_attempts_check CHECK ((api_attempts > 0)),
    CONSTRAINT model_attempts_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT model_attempts_kind_check CHECK ((kind = ANY (ARRAY['call'::text, 'probe'::text, 'connection-test'::text]))),
    CONSTRAINT model_attempts_state_check CHECK ((state = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])))
);

ALTER TABLE public.model_attempts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.model_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.model_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose text NOT NULL,
    state text NOT NULL,
    input_tokens integer,
    output_tokens integer,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subject text,
    model text,
    input_hash text,
    input_summary jsonb,
    response jsonb,
    finished_at timestamp with time zone,
    request_key text,
    reused_count integer DEFAULT 0 NOT NULL,
    api_attempts integer DEFAULT 0 NOT NULL,
    model_config_id text,
    CONSTRAINT model_calls_api_attempts_check CHECK (((api_attempts >= 0) AND (api_attempts <= 3))),
    CONSTRAINT model_calls_state_check CHECK ((state = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])))
);

CREATE TABLE public.model_events (
    id bigint NOT NULL,
    model_config_id text,
    event_type text NOT NULL,
    from_model_config_id text,
    to_model_config_id text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_events_event_type_check CHECK ((event_type = ANY (ARRAY['fallback'::text, 'recovered'::text, 'unavailable'::text, 'healthy'::text, 'paused'::text, 'primary-changed'::text, 'config-changed'::text])))
);

ALTER TABLE public.model_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.model_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.model_health (
    model_config_id text NOT NULL,
    state text DEFAULT 'unverified'::text NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    consecutive_successes integer DEFAULT 0 NOT NULL,
    cooldown_until timestamp with time zone,
    last_probe_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_health_state_check CHECK ((state = ANY (ARRAY['unverified'::text, 'healthy'::text, 'degraded'::text, 'unavailable'::text])))
);

CREATE TABLE public.model_routing (
    id smallint DEFAULT 1 NOT NULL,
    current_model_config_id text,
    current_model_healthy boolean,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_routing_id_check CHECK ((id = 1))
);

CREATE TABLE public.news_changes (
    id bigint NOT NULL,
    event_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.news_changes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.news_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.processing_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject text NOT NULL,
    run_key text NOT NULL,
    stage text NOT NULL,
    state text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    result jsonb,
    error text,
    call_id uuid,
    CONSTRAINT processing_steps_state_check CHECK ((state = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'waiting'::text, 'skipped'::text])))
);

CREATE TABLE public.reprocessing_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    range_start timestamp with time zone NOT NULL,
    range_end timestamp with time zone NOT NULL,
    scope text NOT NULL,
    state text DEFAULT 'waiting'::text NOT NULL,
    total integer NOT NULL,
    regenerate_date date,
    generation_job_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT reprocessing_batches_check CHECK ((range_end > range_start)),
    CONSTRAINT reprocessing_batches_scope_check CHECK ((scope = ANY (ARRAY['outdated'::text, 'all'::text]))),
    CONSTRAINT reprocessing_batches_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'processing'::text, 'generating'::text, 'completed'::text, 'completed_with_errors'::text, 'failed'::text])))
);

CREATE TABLE public.reprocessing_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    article_id uuid,
    article_snapshot jsonb NOT NULL,
    state text DEFAULT 'waiting'::text NOT NULL,
    job_id uuid,
    error text,
    finished_at timestamp with time zone,
    CONSTRAINT reprocessing_items_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'queued'::text, 'processed'::text, 'ignored'::text, 'failed'::text])))
);

CREATE TABLE public.screening_usage_members (
    article_id uuid NOT NULL,
    batch_key text NOT NULL,
    batch_size integer NOT NULL,
    member_index integer NOT NULL,
    CONSTRAINT screening_usage_members_batch_size_check CHECK (((batch_size >= 1) AND (batch_size <= 20))),
    CONSTRAINT screening_usage_members_check CHECK (((member_index >= 0) AND (member_index < batch_size)))
);

CREATE TABLE public.sessions (
    hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.settings (
    id integer NOT NULL,
    value jsonb NOT NULL,
    CONSTRAINT settings_id_check CHECK ((id = 1))
);

CREATE TABLE public.source_discoveries (
    source_id uuid NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    inserted boolean DEFAULT false NOT NULL,
    material_kind text DEFAULT 'unknown'::text NOT NULL,
    CONSTRAINT source_discoveries_material_kind_check CHECK ((material_kind = ANY (ARRAY['full'::text, 'summary'::text, 'title'::text, 'unknown'::text])))
);

CREATE TABLE public.source_hosts (
    host text NOT NULL,
    next_request_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_until timestamp with time zone
);

CREATE TABLE public.source_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verdict text NOT NULL,
    evidence_kind text NOT NULL,
    completeness text NOT NULL,
    note text NOT NULL,
    urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT source_reviews_completeness_check CHECK ((completeness = ANY (ARRAY['sufficient'::text, 'thin'::text, 'title'::text, 'unknown'::text]))),
    CONSTRAINT source_reviews_evidence_kind_check CHECK ((evidence_kind = ANY (ARRAY['original'::text, 'reprint'::text, 'aggregator'::text, 'unknown'::text]))),
    CONSTRAINT source_reviews_verdict_check CHECK ((verdict = ANY (ARRAY['keep'::text, 'scope'::text, 'slower'::text, 'stop'::text, 'observe'::text])))
);

CREATE TABLE public.sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    url text,
    format text NOT NULL,
    industry_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_fetched_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    interval_minutes integer DEFAULT 60 NOT NULL,
    etag text,
    next_fetch_at timestamp with time zone,
    auto_interval boolean DEFAULT false NOT NULL,
    min_interval_minutes integer DEFAULT 60 NOT NULL,
    max_interval_minutes integer DEFAULT 240 NOT NULL,
    interval_reason text,
    quiet_runs integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    stable_runs integer DEFAULT 0 NOT NULL,
    origin_address text DEFAULT ''::text NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    catalog_key text,
    priority text DEFAULT 'P1'::text NOT NULL,
    verification_status text DEFAULT 'pending'::text NOT NULL,
    verification_note text DEFAULT ''::text NOT NULL,
    verified_at timestamp with time zone,
    notes text DEFAULT ''::text NOT NULL,
    additional_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    read_details boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 1000000 NOT NULL,
    CONSTRAINT sources_enabled_endpoint CHECK (((NOT enabled) OR ((url IS NOT NULL) AND (format <> 'manual'::text)))),
    CONSTRAINT sources_format_check CHECK ((format = ANY (ARRAY['rss'::text, 'json'::text, 'html'::text, 'manual'::text]))),
    CONSTRAINT sources_interval_minutes_check CHECK (((interval_minutes >= 5) AND (interval_minutes <= 1440))),
    CONSTRAINT sources_priority_check CHECK ((priority = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text]))),
    CONSTRAINT sources_sections_check CHECK ((jsonb_typeof(sections) = 'array'::text)),
    CONSTRAINT sources_verification_status_check CHECK ((verification_status = ANY (ARRAY['pending'::text, 'approved'::text, 'failed'::text])))
);

CREATE TABLE public.subscription_confirmations (
    email text NOT NULL,
    token_hash text NOT NULL,
    kinds jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone
);

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    kinds jsonb NOT NULL,
    token_hash text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    unsubscribed_at timestamp with time zone
);

ALTER TABLE ONLY public.article_screenings
    ADD CONSTRAINT article_screenings_pkey PRIMARY KEY (article_id, input_key);

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_url_key UNIQUE (url);

ALTER TABLE ONLY public.brief_requests
    ADD CONSTRAINT brief_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.briefs
    ADD CONSTRAINT briefs_kind_period_date_key UNIQUE (kind, period_date);

ALTER TABLE ONLY public.briefs
    ADD CONSTRAINT briefs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collection_items
    ADD CONSTRAINT collection_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collection_runs
    ADD CONSTRAINT collection_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_brief_id_subscription_id_key UNIQUE (brief_id, subscription_id);

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.edition_runs
    ADD CONSTRAINT edition_runs_pkey PRIMARY KEY (period_date, section);

ALTER TABLE ONLY public.event_developments
    ADD CONSTRAINT event_developments_event_id_fact_hash_key UNIQUE (event_id, fact_hash);

ALTER TABLE ONLY public.event_developments
    ADD CONSTRAINT event_developments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.industries
    ADD CONSTRAINT industries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.mail_send_runtime
    ADD CONSTRAINT mail_send_runtime_pkey PRIMARY KEY (connection_key);

ALTER TABLE ONLY public.model_attempts
    ADD CONSTRAINT model_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.model_calls
    ADD CONSTRAINT model_calls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.model_events
    ADD CONSTRAINT model_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.model_health
    ADD CONSTRAINT model_health_pkey PRIMARY KEY (model_config_id);

ALTER TABLE ONLY public.model_routing
    ADD CONSTRAINT model_routing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.news_changes
    ADD CONSTRAINT news_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.processing_steps
    ADD CONSTRAINT processing_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.processing_steps
    ADD CONSTRAINT processing_steps_subject_run_key_stage_key UNIQUE (subject, run_key, stage);

ALTER TABLE ONLY public.reprocessing_batches
    ADD CONSTRAINT reprocessing_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reprocessing_items
    ADD CONSTRAINT reprocessing_items_batch_id_article_id_key UNIQUE (batch_id, article_id);

ALTER TABLE ONLY public.reprocessing_items
    ADD CONSTRAINT reprocessing_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.screening_usage_members
    ADD CONSTRAINT screening_usage_members_pkey PRIMARY KEY (article_id, batch_key);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (hash);

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_discoveries
    ADD CONSTRAINT source_discoveries_pkey PRIMARY KEY (source_id, url);

ALTER TABLE ONLY public.source_hosts
    ADD CONSTRAINT source_hosts_pkey PRIMARY KEY (host);

ALTER TABLE ONLY public.source_reviews
    ADD CONSTRAINT source_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_catalog_key_key UNIQUE (catalog_key);

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscription_confirmations
    ADD CONSTRAINT subscription_confirmations_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.subscription_confirmations
    ADD CONSTRAINT subscription_confirmations_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_email_key UNIQUE (email);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_token_hash_key UNIQUE (token_hash);

CREATE INDEX article_screenings_batch ON public.article_screenings USING btree (batch_key);

CREATE INDEX articles_event ON public.articles USING btree (event_id);

CREATE INDEX articles_pending_period ON public.articles USING btree (published_at) WHERE (state = 'pending'::text);

CREATE UNIQUE INDEX brief_requests_active ON public.brief_requests USING btree (kind, period_date) WHERE (state = ANY (ARRAY['waiting'::text, 'queued'::text]));

CREATE UNIQUE INDEX briefs_issue_number_unique ON public.briefs USING btree (kind, EXTRACT(year FROM period_date), issue_number);

CREATE INDEX collection_items_source_day ON public.collection_items USING btree (source_id, observed_at);

CREATE INDEX developments_period ON public.event_developments USING btree (happened_at, event_id);

CREATE INDEX events_period ON public.events USING btree (occurred_at DESC);

CREATE INDEX model_attempts_model_time ON public.model_attempts USING btree (model_config_id, started_at DESC);

CREATE INDEX model_attempts_time ON public.model_attempts USING btree (started_at DESC);

CREATE INDEX model_calls_day ON public.model_calls USING btree (created_at);

CREATE UNIQUE INDEX model_calls_request_key ON public.model_calls USING btree (request_key) WHERE (request_key IS NOT NULL);

CREATE INDEX model_calls_subject ON public.model_calls USING btree (subject, created_at DESC);

CREATE INDEX model_events_time ON public.model_events USING btree (created_at DESC);

CREATE INDEX news_changes_event ON public.news_changes USING btree (event_id, id);

CREATE INDEX processing_steps_subject ON public.processing_steps USING btree (subject, started_at);

CREATE INDEX reprocessing_items_pending ON public.reprocessing_items USING btree (batch_id, state);

CREATE INDEX screening_usage_members_batch ON public.screening_usage_members USING btree (batch_key);

CREATE INDEX source_discoveries_first_seen ON public.source_discoveries USING btree (source_id, first_seen_at);

CREATE INDEX source_discoveries_url ON public.source_discoveries USING btree (url);

CREATE INDEX source_reviews_recent ON public.source_reviews USING btree (source_id, created_at DESC);

CREATE UNIQUE INDEX sources_url_unique ON public.sources USING btree (url);

ALTER TABLE ONLY public.article_screenings
    ADD CONSTRAINT article_screenings_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.article_screenings
    ADD CONSTRAINT article_screenings_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.model_calls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_industry_id_fkey FOREIGN KEY (industry_id) REFERENCES public.industries(id);

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.collection_items
    ADD CONSTRAINT collection_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.collection_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.collection_items
    ADD CONSTRAINT collection_items_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.collection_runs
    ADD CONSTRAINT collection_runs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_brief_id_fkey FOREIGN KEY (brief_id) REFERENCES public.briefs(id);

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.event_developments
    ADD CONSTRAINT event_developments_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.event_developments
    ADD CONSTRAINT event_developments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_industry_id_fkey FOREIGN KEY (industry_id) REFERENCES public.industries(id);

ALTER TABLE ONLY public.model_attempts
    ADD CONSTRAINT model_attempts_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.model_calls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.news_changes
    ADD CONSTRAINT news_changes_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.processing_steps
    ADD CONSTRAINT processing_steps_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.model_calls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reprocessing_items
    ADD CONSTRAINT reprocessing_items_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reprocessing_items
    ADD CONSTRAINT reprocessing_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.reprocessing_batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.screening_usage_members
    ADD CONSTRAINT screening_usage_members_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_discoveries
    ADD CONSTRAINT source_discoveries_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_reviews
    ADD CONSTRAINT source_reviews_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_industry_id_fkey FOREIGN KEY (industry_id) REFERENCES public.industries(id);

-- Stable identifier for articles and events in a single-publication installation.
INSERT INTO public.industries (id,name,description,sections,position)
VALUES ('general','行业简报','通用资讯','[]',0);

INSERT INTO public.model_routing(id) VALUES (1);
