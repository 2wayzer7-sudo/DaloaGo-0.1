# DaloaGo

DaloaGo est un MVP VTC pour réserver et opérer des courses locales à Daloa.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/daloago/src/App.tsx` — parcours passager, chauffeur et opérations
- `artifacts/daloago/src/index.css` — tokens et styles de l'interface
- `artifacts/api-server/src/routes/` — endpoints courses, chauffeurs et dashboard
- `lib/db/src/schema/` — tables PostgreSQL
- `lib/api-spec/openapi.yaml` — contrat API source
- `render.yaml` — services Render séparés pour le web et l'API
- `.github/workflows/ci.yml` — vérification GitHub Actions

## Architecture decisions

- Le premier MVP utilise un espace de démonstration sans authentification locale : le changement de rôle sert à valider les parcours passager, chauffeur et opérations.
- Le tarif estimé est calculé côté API à partir d'un forfait, de la distance et de la durée.
- L'interface consomme uniquement les hooks générés depuis OpenAPI pour garder le contrat serveur/client synchronisé.

## Product

DaloaGo permet de demander une course, de suivre son statut, de laisser un chauffeur accepter puis terminer une demande, et de superviser l'activité du réseau avec des données persistées.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Après une modification de `lib/api-spec/openapi.yaml`, relancer le codegen avant de modifier les routes ou les hooks.
- Le service web Render utilise `VITE_API_BASE_URL` pour joindre le service API indépendant.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
