-- Reject partially shaped FAQ objects at the database boundary.
CREATE OR REPLACE FUNCTION public.mini_session_faqs_are_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT COALESCE(
        jsonb_typeof(value) = 'array'
        AND jsonb_array_length(value) <= 50
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(value) AS faq(item)
            WHERE jsonb_typeof(item) <> 'object'
               OR NOT (item ?& ARRAY['id', 'question', 'answerHtml', 'sortOrder'])
               OR char_length(btrim(item ->> 'id')) NOT BETWEEN 1 AND 120
               OR char_length(btrim(item ->> 'question')) NOT BETWEEN 1 AND 240
               OR char_length(btrim(item ->> 'answerHtml')) NOT BETWEEN 1 AND 10000
               OR (item ->> 'sortOrder') !~ '^[0-9]+$'
               OR (item ->> 'sortOrder')::integer NOT BETWEEN 0 AND 49
        )
        AND (
            SELECT count(*) = count(DISTINCT (item ->> 'sortOrder')::integer)
            FROM jsonb_array_elements(value) AS faq(item)
        ),
        false
    );
$$;

REVOKE ALL ON FUNCTION public.mini_session_faqs_are_valid(jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mini_session_faqs_are_valid(jsonb)
    TO service_role;
