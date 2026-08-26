-- Session-cookie migration (security audit finding #1), phases 2/3: the
-- staff and customer bearer tokens every existing browser tab is holding in
-- localStorage are being replaced with cookies, and old refresh tokens
-- would otherwise still work indefinitely against the new /auth/refresh and
-- /public/:shopSlug/auth/refresh endpoints (they just read the refresh
-- token off a body field before this migration; nothing about the token
-- itself changes shape). Revoking every outstanding refresh token forces a
-- real re-login on the new cookie flow instead of leaving a mixed
-- old-body/new-cookie transition window live — see CLAUDE.md's own
-- migration-path reasoning for why a clean cut-over was chosen over dual
-- support. Access tokens (15min TTL) age out on their own shortly after
-- deploy regardless.
UPDATE refreshtoken SET revokedAt = NOW() WHERE revokedAt IS NULL;
UPDATE customerrefreshtoken SET revokedAt = NOW() WHERE revokedAt IS NULL;
