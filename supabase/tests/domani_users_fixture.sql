CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz,last_sign_in_at timestamptz,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,encrypted_password text);
CREATE TABLE auth.identities(user_id uuid,provider text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,full_name text,signup_cohort text,signup_method text,timezone text,created_at timestamptz,last_active_at timestamptz,deleted_at timestamptz,deletion_scheduled_for timestamptz);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON public.profiles TO service_role;
INSERT INTO public.profiles(id,email,full_name,signup_cohort,signup_method,timezone,created_at)
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'user'||n||'@example.test','User '||n,'general','apple','UTC','2026-09-01Z' FROM generate_series(1,125) n;
INSERT INTO auth.users(id,created_at,last_sign_in_at,email_confirmed_at) SELECT id,created_at,now(),now() FROM public.profiles WHERE email<>'user125@example.test';
INSERT INTO auth.identities SELECT id,'apple' FROM auth.users;
INSERT INTO auth.identities SELECT id,'google' FROM auth.users WHERE id='10000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET last_active_at=now()-interval '1 day' WHERE email='user1@example.test';
UPDATE public.profiles SET deleted_at=now(),deletion_scheduled_for=now()+interval '30 days' WHERE email='user2@example.test';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-4000-8000-000000000003';
CREATE VIEW public.profiles_dashboard AS SELECT id,email FROM public.profiles;
GRANT SELECT ON public.profiles_dashboard TO anon,authenticated;
-- Same email is not evidence of the same user. Latest dated device is selected by ID.
INSERT INTO public.support_requests(id,user_id,email,category,description,status,created_at,platform,device_model,app_version)
VALUES ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','user1@example.test','other','synthetic','pending','2026-09-19Z','android','Other phone','4');
