# Krono project notes

Krono is Oscar's Spanish personal work calendar. Keep it focused on shifts, paid hours, breaks, salary estimates, and the mobile-first calendar.

## Data and sync

- `index.html` is the client application. `api/auth.js` authenticates the user; `api/data.js` saves data to a private Vercel Blob. `lib/session.js` signs the HttpOnly session cookie.
- Local data is cached in `localStorage` under `krono_data_v1`; preserve migration from `krono_shifts` and `krono_jobs`.
- The Blob pathname is fixed server-side. Keep storage private. Never expose Vercel OIDC credentials, `BLOB_READ_WRITE_TOKEN`, `KRONO_PASSWORD`, or `KRONO_SESSION_SECRET` to the browser.
- The client synchronizes after edits and polls for other-device changes. Preserve ETag conflict checks; do not overwrite concurrent changes silently.
- JSON backups contain personal schedule and salary data. Preserve fields such as `jobs`, `shifts`, `breakRules`, `taxRate`, `monthlyGross`, `monthlyNet`, and `currency`.
- Codex may inspect a backup JSON the user explicitly shares, and should return edits in the same format. Do not upload that backup to another service.
- The remote MCP endpoint is `/mcp`, with OAuth tokens signed by `KRONO_SESSION_SECRET`; never pass Vercel Blob credentials to clients. Keep its `krono:read` and `krono:write` scopes separate and preserve conditional ETag checks for every write.

## Product rules

- The current job profile and net-pay basis are derived from the user's payslip but loaded only after authentication from private Vercel environment variables. Do not hardcode personal payroll amounts in the client or repository.
- Break defaults reflect the user's examples: 30 minutes from 5.5 hours and 60 minutes from 8 hours, unpaid by default. Break rules are configurable in Ajustes and should not be conflated with Swiss statutory minimums.
- Times use the local timezone and 24-hour clock. An end earlier than a start is an overnight shift.
- Preserve `input type="time"` for the native iPhone time picker. Keep tap targets comfortable and the dark theme readable on small iPhone screens.
- The weekly view summarizes actual recorded hours and estimated gross/net income. Do not add weekly target hours or planned schedule UI.
