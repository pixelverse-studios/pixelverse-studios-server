CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.beta_feedback (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, email text NOT NULL, category text NOT NULL CHECK(category IN ('bug_report','feature_idea','what_i_love','general')), message text NOT NULL,
 status text NOT NULL CHECK(status IN ('new','reviewed','actioned','archived')), created_at timestamptz, updated_at timestamptz,
 platform text, os_version text, device_brand text, device_model text, app_version text, app_build text
);
CREATE TABLE public.support_requests (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, email text NOT NULL, category text NOT NULL CHECK(category IN ('technical_issue','account_help','billing_question','other')), description text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','in_progress','resolved','closed')), created_at timestamptz, updated_at timestamptz,
 platform text, os_version text, device_brand text, device_model text, app_version text, app_build text
);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.beta_feedback,public.support_requests TO service_role;
INSERT INTO public.beta_feedback(id,user_id,email,category,message,status,created_at,platform)
SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','fixture@example.test','bug_report','message '||n,'new','2026-09-01Z'::timestamptz + n * interval '1 hour','ios' FROM generate_series(1,125) n;
INSERT INTO public.support_requests(id,user_id,email,category,description,status,created_at)
VALUES ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','support@example.test','technical_issue','literal %_ search','pending','2026-09-17T23:59:59.999Z');
