# Connect a Vercel frontend to this backend

The frontend includes `vercel.json` for static Vite hosting. Continue running this backend as a persistent Node.js server with `npm run build` and `npm start` so its import, allocation and notification workers remain active.

Configure the backend server environment with the real deployed domains:

```dotenv
NODE_ENV=production
PUBLIC_API_URL=https://api.example.com/api/v1
FRONTEND_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
```

Use the exact frontend origin, without a trailing slash. Multiple approved origins may be comma-separated. Keep existing origins only while their websites are still in use. Invitation/password-reset links use `FRONTEND_URL`. Restart the backend after changing its environment. The current production startup validation already requires HTTPS and the auth middleware uses the explicit CORS allowlist.

In the Vercel frontend project, set `VITE_API_URL` to the actual `PUBLIC_API_URL` value. In native mobile builds, use `EXPO_PUBLIC_API_URL` with that same API URL. All API uploads go directly to the backend, preserving the existing 100 MB workbook limit. Keep your reverse proxy configured to accept those request sizes.

Prefer frontend/API subdomains of the same parent domain for browser refresh-cookie compatibility. Test login, page reload, logout, invitation links and file uploads after changing domains.

Do not deploy `src/server.ts` unchanged as a Vercel Function: persistent interval workers need their own runtime, and direct function requests have upload limits below this application's supported workbook size. Moving the API to Vercel needs a separate worker and upload architecture. No serverless backend entry point or worker shutdown is introduced by the frontend deployment configuration.

Do not copy MongoDB, JWT, AWS or SMTP secrets into Vercel `VITE_*` variables.
