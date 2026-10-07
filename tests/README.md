Run from the repository root:

```sh
npm ci --prefix tests
node tests/node_modules/playwright/cli.js install chromium
npm test --prefix tests
```

No production credentials are needed. All fixtures use example.test addresses. Database tests use an isolated PostgreSQL WASM instance. Browser tests serve the real admin files locally and mock only the Supabase client; all external requests are blocked.

Optional environment variables: RHO_CHROMIUM_EXECUTABLE_PATH for a preinstalled headless browser, RHO_PREVIEW_OUTPUT for a PNG screenshot of the sample client list. No screenshot is produced by default.

Pruebas de seguridad administrativa: `npm run test:security --prefix tests`. Usan datos ficticios y servicios locales; no vinculan un autenticador real ni modifican producción.
