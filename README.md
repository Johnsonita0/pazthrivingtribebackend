# PAZ Thriving Tribe Backend

Vercel API backend for the PAZ Thriving Tribe frontend. The `api/` directory contains Vercel function entry points, and `server-handlers/` contains the shared endpoint implementations.

## Local development

Use Node.js 20.12 or newer. The local API loads `backend/.env.local` when present, otherwise `backend/.env`, and prints a warning if `OPENAI_API_KEY` is unavailable to the server process.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` (or `.env`) and configure the required values.
3. Run `npm run dev` to start the API on `http://localhost:3001`.
4. After changing `.env`, restart the API server.

The frontend's Vite development server proxies `/api` requests to this local API server.

## Vercel deployment

Import this repository as a separate Vercel project with the project root set to the repository root. Vercel detects the functions in `api/`; no build command is required. Add the variables from `.env.example` to the Vercel project's Environment Variables. Keep `SUPABASE_SERVICE_ROLE_KEY`, payment secrets, webhook secrets, and email provider keys in the backend project only.

After deploying, configure the frontend to send its `/api` requests to this project's domain. The API enables cross-origin requests so the frontend and backend can be deployed separately.

## Mentor Charles AI chat

Set `OPENAI_API_KEY` in the backend environment and in the backend Vercel project's Environment Variables to enable Mentor Charles replies. `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`. Keep the OpenAI key on the backend; do not add it to frontend environment variables. Mentor Charles verifies signed-in users using the backend `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the same server credentials used by other protected backend routes. These must belong to the Supabase project used by the frontend's `VITE_SUPABASE_URL`. Conversation history is kept only in the active browser session.

## Cloudflare R2 product files

Create a private R2 bucket and an R2 API token scoped to that bucket with object read/write permissions. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` in this backend's local `.env` and Vercel environment. Do not add these values to frontend environment variables.

Configure the bucket's CORS policy with this rule (include any additional custom frontend domains you use):

```json
[
	{
		"AllowedOrigins": [
			"http://localhost:5173",
			"https://pazthrivingtribe.org",
			"https://www.pazthrivingtribe.org"
		],
		"AllowedMethods": ["PUT"],
		"AllowedHeaders": ["Content-Type"],
		"ExposeHeaders": ["ETag"],
		"MaxAgeSeconds": 3600
	}
]
```

New admin and vendor PDF/ZIP uploads use R2; product references are stored as `r2://...` in Supabase. Existing Supabase Storage product files continue to work. R2 objects stay private and are delivered via short-lived signed URLs or server-side purchase email attachments.