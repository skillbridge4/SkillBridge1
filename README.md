# SkillBridge - Youth Skill Development and Internship Finder

SkillBridge is a youth skill development and internship finder with a local-first PWA, Firestore catalog services, authentication helpers, and an application tracker.

## Project structure

- `index.html`, `css/`, and `js/`: Vite frontend entry point, styles, and application logic.
- `client/src/`: shared filter constants and Firebase client services.
- `server/`: Express API and certificate utilities.
- `data/seed/`: canonical company, internship, course, video, and learning-path data.
- `public/`: generated answer-free learning-path metadata and the service worker.
- `scripts/` and `tests/`: data maintenance, validation, unit, rules, and browser tests.
- `reports/`: output from link and video checks.
- Root configuration and `package.json`: Vite, Firebase Hosting, and project scripts.

## Current catalog status

The supplied project previously contained internship-shaped records with placeholder `careers.example.com` links and none verified. Those placeholder listings have been removed from the app and the deployable internship seed is intentionally empty until official program pages can be checked. The organization catalog contains 113 requested India-based/India-operating organizations; every record is marked `verified: false` and its unknown location and URLs are `null`. Course and internship totals on the home page are computed from the currently loaded catalogs. The video catalog includes 128 internship-preparation entries: 48 videos whose titles and channels have been matched against YouTube oEmbed, and 80 unverified search links. The video catalog does not claim that search results are verified videos.

Do not treat unverified catalog records as current openings or application instructions. Add a verified internship only after confirming the program and application page on the organization's official site.

## Running on Windows

The project root (the folder containing `package.json`) is the `youth` folder.
Open that folder in VS Code, then open a terminal there. Install dependencies
once and start the app:

```powershell
npm install
npm run dev
```

If PowerShell reports that running scripts is disabled, use `npm.cmd run dev`
instead.

The app is available at:

- Web app: http://localhost:3000
- API: http://localhost:3001

You can also double-click `START-PROJECT.bat` in the parent folder to start the
project from the correct directory.

Common fixes:

- `ENOENT` for `package.json`: the command was run from the parent folder.
  Open the `youth` folder in VS Code, or use `START-PROJECT.bat`.
- `running scripts is disabled`: in PowerShell, use `npm.cmd` instead of
  `npm`, or enable scripts for your user with
  `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- `Port 3000 is already in use` (or port 3001): stop the old process only after
  confirming its PID. For example, inspect port 3000 with
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress,OwningProcess`,
  then stop that PID with `Stop-Process -Id <PID>`. Substitute `3001` to inspect
  the API port. The startup check prints the same commands for occupied ports
  and never stops processes automatically.

Development ports are centralized in `scripts\dev-config.mjs`. To override
them, copy the root `.env.example` to `.env` and set `SKILLBRIDGE_WEB_PORT`,
`SKILLBRIDGE_API_PORT`, or `SKILLBRIDGE_TEST_WEB_PORT`. Vite uses
`strictPort: true`, so it fails rather than silently switching ports.

For Firebase Authentication, add `localhost` and `127.0.0.1` to the project's
Authorized domains in Firebase Console. Firebase authorized domains are host
names only; do not include a port. If Firebase is not configured, the browser
logs one info line and uses the bundled seed catalogs. Login is disabled and
guest activity remains in `localStorage`.

## Run locally

After installing dependencies once, start the project from this folder with
`npm run dev` (or `npm.cmd run dev` in PowerShell if script execution is
restricted).

## AI Guidance and Resume Analyser

Both tools work with `AI_ENABLED=false` (the default) using local, catalog-based
rules. To enable provider suggestions, copy `server\.env.example` to
`server\.env` and set these server-only values:

```env
AI_ENABLED=true
AI_PROVIDER=openai
AI_API_KEY=your-provider-key
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=20000
```

The adapter currently supports `openai` and `anthropic`. To switch providers,
change `AI_PROVIDER`, use a model supported by that provider in `AI_MODEL`, and
replace `AI_API_KEY` with its key. Keep the key only in `server\.env`; never add
it to a `VITE_*` variable or client file. The server verifies Firebase ID tokens
for live AI requests, so configure Firebase Admin credentials as described
below. Guests can use the rule-based mode.

The API is available at `GET /api/ai/status`, `POST /api/ai/guidance`, and
`POST /api/ai/resume`. Resume uploads accept PDF or DOCX files up to 2 MB; pasted
or extracted text is limited to 20,000 characters. Scanned and encrypted files
cannot be analysed. Requests have a provider timeout, per-IP and per-user
rolling limits, and daily quotas (20 requests per signed-in user and 40 per IP).
Rate-limited or unavailable provider requests use rule-based results where
possible.

The app asks for consent before sending details to the SkillBridge server and,
when enabled, the configured AI provider. Resume files are parsed in memory;
resume text and uploaded files are not retained. Roadmaps and reports are saved
only when you choose **Save roadmap** or **Save report**. **Delete my AI data**
removes those saved items from your account or this browser. AI suggestions are
advice, not a guarantee of hiring; confirm details with official sources.

Run the AI unit tests with `npm run test:ai`. `npm run test:e2e` includes mocked
AI feature flows. `npm run test:rules` checks owner-only Firestore access and
requires the Firestore emulator. `npm run check` runs the project checks,
including the AI tests and production build.

## Firebase setup

1. Create a Firebase project and register a **Web app** in the Firebase console.
2. In **Authentication → Sign-in method**, enable **Google** and **Email/Password**.
   For Google, also select a support email.
3. In **Authentication → Settings → Authorized domains**, add `localhost` and
   `127.0.0.1`. Domains must not include a port.
4. Create the default Firestore database.
5. From the `youth` project root, copy the environment template:

   ```powershell
   Copy-Item .env.example .env
   ```

   Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
   `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. The
   `VITE_FIREBASE_MEASUREMENT_ID` value is optional. Vite reads this root
   `.env` file; it does not read `client\.env`. Restart `npm run dev` after
   changing it. The Firebase web-app config is public client configuration,
   not a service-account key. Never put service-account credentials in a
   `VITE_*` variable or client file.

6. Copy the server environment template:

   ```powershell
   Copy-Item server\.env.example server\.env
   ```

   Set `FIREBASE_PROJECT_ID` and place the Firebase Admin service-account JSON at the ignored path in `FIREBASE_SERVICE_ACCOUNT_PATH` (default: `server\service-account.json`). Never commit the service-account key.
7. Select the Firebase project and deploy rules/indexes:

   ```powershell
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```

8. Review the seed before writing, then seed stable document IDs:

   ```powershell
   npm run seed -- --dry-run
   npm run seed
   ```

   Create an admin by Firebase Auth UID after the account exists:

   ```powershell
   npm run seed -- --make-admin=AUTH_UID
   ```

   Optional: seed only one collection with `npm run seed -- --collection=companies`.
9. Build and deploy Firebase Hosting:

   ```powershell
   npm run build
   firebase deploy --only hosting
   ```

## SkillBridge learning certificates

Learning paths are defined in `data/seed/paths.json`. After editing the paths,
run `npm run build:learning-paths` to regenerate the answer-free
`public/learning-paths.json` metadata. `npm run validate:data` checks it against
the server source and shared path IDs. The API validates video and course IDs
against the bundled catalogs when it starts; only answer-free path metadata is
sent to the browser. Paths are not seeded into Firestore. The server randomizes quiz
questions and options, grades submitted answers, and enforces three attempts
per path per 24 hours. Every required video must be marked watched. A required
third-party course step is only a self-declaration; SkillBridge cannot verify
external course completion. The server re-checks progress and the stored quiz
result before issuing one active certificate per user and path.

Certificates are signed with `CERTIFICATE_HMAC_SECRET`. Generate a unique local
secret with Node and put it in `server\.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Set `FIREBASE_PROJECT_ID`, `CERTIFICATE_HMAC_SECRET` (at least 32 characters),
`FIREBASE_SERVICE_ACCOUNT_PATH` (local only; never commit the key), and
`ALLOWED_ORIGINS` in `server\.env` for hosted origins. Local CORS origins are
derived from the configured web port. For Cloud Run, use its runtime service
account / Application Default Credentials and store the HMAC secret in Secret
Manager; do not bake credentials into the image. `ALLOWED_ORIGINS` is a
comma-separated list. Configure `VITE_FIREBASE_*` in the project-root `.env` (or use the emulator command below); the
optional `VITE_API_BASE_URL` is only needed when the API is hosted on another
origin. The `/api/**` Hosting rewrite targets the `skillbridge-api` Cloud Run
service in `us-central1`.

   For local emulator testing, no production Firebase config or service-account
   file is needed. From the `youth` project root run:

   ```powershell
   npm run dev:emulator
   ```

   This starts the Auth and Firestore emulators under the `demo-skillbridge`
   project and launches the web app and API with the explicit
   `VITE_USE_AUTH_EMULATOR=true` flag. The client uses demo config values and
   connects only to `127.0.0.1`; it does not use a production Firebase project.
   Open the app at http://localhost:3000, the Auth emulator at
   http://127.0.0.1:4000/auth, and the Firestore emulator at
   http://127.0.0.1:4000/firestore. Keep the app origin consistent while signing
   in; do not switch between `localhost` and `127.0.0.1` during one test.

   To start only the emulators in a separate terminal, use `npm run emulators`.
   Set the client and Admin SDK emulator variables in the terminal that launches
   the app before running `npm run dev`:

   ```powershell
   $env:VITE_USE_AUTH_EMULATOR = 'true'
   $env:VITE_FIREBASE_PROJECT_ID = 'demo-skillbridge'
   $env:VITE_FIREBASE_AUTH_EMULATOR_HOST = 'http://127.0.0.1:9099'
   $env:VITE_FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
   $env:FIREBASE_PROJECT_ID = 'demo-skillbridge'
   $env:GCLOUD_PROJECT = 'demo-skillbridge'
   $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
   $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
   npm run dev
   ```

   Run the browser suite against fresh emulators with `npm run test:e2e:emulator`.
   This includes the email, guest, persistence, and Google popup flows.
   Development mode unregisters the production PWA service worker so it cannot
   cache Vite modules or interfere with HMR. Vite sends
   `Cross-Origin-Opener-Policy: same-origin-allow-popups` for OAuth popups.

   Save the user's profile name before issuing a certificate. The user must
   explicitly consent to showing their name and path title on the public
   verification page. The optional public score is off by default. Owners can
   revoke/delete their certificates; admins can revoke certificates with a
   reason. Client writes to certificate and quiz-result collections are denied
   by Firestore rules.

Deploy `firestore.rules` and `firestore.indexes.json` before enabling
certificates. Cloud Run's service account needs Firestore access and Firebase
Auth token-verification permissions. Public verification at `/verify/:certId`
returns only the status, recipient name, path title, issue date, and issuer
(plus score only when the owner opted in). Certificates are SkillBridge
completion records, not accredited qualifications; they do not imply
third-party endorsement, accreditation, or a job guarantee.
Per-IP API throttles are shared through short-lived Firestore records; quiz
attempt caps are separately enforced by per-user or per-guest Firestore ledgers.

To deploy the API after creating a Secret Manager secret named
`certificate-hmac` and granting the Cloud Run runtime identity access to it:

```powershell
gcloud run deploy skillbridge-api --source . --region us-central1 --project PROJECT_ID --allow-unauthenticated --set-env-vars="FIREBASE_PROJECT_ID=PROJECT_ID,ALLOWED_ORIGINS=https://PROJECT_ID.web.app" --set-secrets="CERTIFICATE_HMAC_SECRET=certificate-hmac:latest"
```

The service is intentionally publicly invokable so Firebase Hosting can proxy
public path and verification requests; every account operation still requires
a verified Firebase ID token, and admin operations also check the server-side
admin collection. Deploy Hosting after the Cloud Run service is ready.

## Emulator, validation, and reports

```powershell
npm run test:rules
npm run seed:emulator
npm run validate:data
npm run build:search-tokens
npm run test:search
npm run test:videos
npm run test:certificates
npm run check:videos
npm run test:e2e
npm run check:links
```

`npm run check` runs data validation, search tests, video tests, certificate unit tests, the production build, Playwright smoke tests, and Firestore rules tests. `npm run check:videos` checks video IDs against YouTube oEmbed and writes `reports/video-report.json`; search links are reported as unverified. The browser test runner requires Playwright's browser binaries. `npm run check:links` writes `reports/link-report.json`.

`npm run test:certificates` runs the certificate utility tests. Rules and
authenticated certificate flows require the Firebase emulators; the local
browser smoke suite does not create certificates unless configured with a test
Firebase project.

## Data locations

- `client/src/constants.js`: shared filter values, Indian state/city mappings, stipend bands, and search aliases.
- `data/seed/companies.json`, `internships.json`, `courses.json`, `videos.json`: seed catalogs.
- `client/src/services/`: Firebase initialization, catalog queries/pagination/cache, authentication, user migration, and admin validation/writes.
- `firestore.rules`, `firestore.indexes.json`: Firestore access control and query indexes.
- `scripts/validate-data.mjs`, `build-search-tokens.mjs`, `seed.mjs`, `check-links.mjs`, `check-videos.mjs`: data validation and maintenance.

Catalog additions still needing official-site review are listed in the data files by `verified: false` and `lastVerified`. No stipend, opening, deadline, eligibility, or official company URL is inferred from missing data.
