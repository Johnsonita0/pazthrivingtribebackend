# PAZ Thriving Tribe Backend

Vercel API backend for the PAZ Thriving Tribe frontend. The `api/` directory contains Vercel function entry points, and `server-handlers/` contains the shared endpoint implementations.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure the required values.
3. Run `npm run dev` to start the API on `http://localhost:3001`.

The frontend's Vite development server proxies `/api` requests to this local API server.

## Vercel deployment

Import this repository as a separate Vercel project with the project root set to the repository root. Vercel detects the functions in `api/`; no build command is required. Add the variables from `.env.example` to the Vercel project's Environment Variables. Keep `SUPABASE_SERVICE_ROLE_KEY`, payment secrets, webhook secrets, and email provider keys in the backend project only.

After deploying, configure the frontend to send its `/api` requests to this project's domain. The API enables cross-origin requests so the frontend and backend can be deployed separately.