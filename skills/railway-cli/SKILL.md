---
name: railway-cli
description: Railway CLI login, browserless auth, project linking, deployment, logs, and variables. Use when the user asks how to sign into Railway, access a project from the CLI, deploy with `railway up`, inspect logs, or manage Railway environment variables.
---

# Railway CLI

Use this skill when the task is about Railway access or operations from the command line.

## Quick flow

1. Install the CLI if needed.
2. Authenticate.
3. Link the current folder to the Railway project.
4. Inspect status or open the dashboard.
5. Deploy, inspect logs, or update variables.

## Authentication

Use browser login on a normal local machine:

```bash
railway login
railway whoami
```

Use browserless login in SSH sessions, CI, or any environment without a browser:

```bash
railway login --browserless
```

If `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN` is already set, the CLI uses that token instead of prompting for login.

## Project access

After login, link the local folder to the correct Railway project:

```bash
railway link
railway status
railway open
```

Use `railway open -p` when you only need the dashboard URL.

## Deployment and debugging

For this repo, Railway is Docker-based through `Dockerfile` and `railway.json`.

Common commands:

```bash
railway up
railway logs
railway redeploy
railway restart
railway down
```

Use `railway variables set` for environment variables and `railway unlink` only when the current folder should stop pointing at that Railway project.

## Notes

- Prefer `railway login` unless there is no browser.
- Check `railway whoami` before assuming the CLI is authenticated.
- In this repo, the canonical deployment notes live in `docs/railway-deploy.md`.
