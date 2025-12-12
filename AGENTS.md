# Agent Guide

**Authentication**: Mini App uses `/api/miniapp/*` endpoints with `requireMiniAppAuth`. Dashboard uses `/api/cards/*` with `requireDashboardAuth`. Never call Dashboard endpoints from Mini App (returns 302).
