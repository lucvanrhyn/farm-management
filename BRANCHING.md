# Branching Strategy

## main
The clean skeleton. No client-specific content. This is the base for all new clients.
To start a new client: `git checkout main && git checkout -b client/<client-name>`

## client/* branches
Each branch is a deployed instance for a specific client.

| Branch | Client | Vercel URL |
|--------|--------|------------|
| client/delta-livestock | Delta Livestock | https://example-tenant.vercel.app (TBC) |

## Rules
- Never merge client branches back into main
- Bug fixes that apply to the skeleton should be made on main, then cherry-picked into client branches
- Client credentials, branding, and seed data only ever live on client branches — never on main
