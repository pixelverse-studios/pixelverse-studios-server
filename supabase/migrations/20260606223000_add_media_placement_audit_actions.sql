ALTER TABLE public.media_audit_logs
DROP CONSTRAINT IF EXISTS media_audit_logs_action_check;

ALTER TABLE public.media_audit_logs
ADD CONSTRAINT media_audit_logs_action_check CHECK (
    action IN (
        'upload_created',
        'draft_saved',
        'published',
        'archived',
        'restored',
        'renamed_moved',
        'metadata_edited',
        'reorder_changed',
        'placement_assigned',
        'placement_replaced',
        'placement_cleared'
    )
);
