from source.backend.helpers import get_project_description

API_DESCRIPTION = f"""
{get_project_description()}

## Authentication

Most `/api` endpoints require authentication; a few (e.g. signing in, registration) are reachable without it. Where authentication is required, there are two ways to provide it:

### Session cookie

The web frontend signs in via `POST /api/auth/login` and receives an `HttpOnly` `session` cookie that the
browser then sends automatically on every request. This is what the UI uses; you normally never deal with
it directly.

### API key

For programmatic access, send a personal API key as a Bearer token:

```
Authorization: Bearer qk_your_api_key
```

API keys can **only be created in the web frontend**, under *Settings → API keys*. A key is only shown once at creation time. You can revoke a key from the same screen.

An API key can drive the same data endpoints as the frontend (accounts, transactions, bank connections,
syncing). For safety it **cannot** be used for account self-management (e.g. changing your password or managing two-factor authentication or managing API keys)
"""
