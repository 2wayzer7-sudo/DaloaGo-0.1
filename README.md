# DaloaGo

DaloaGo est un MVP de plateforme VTC pour Daloa : réservation d'une course, suivi du statut, espace chauffeur et tableau de bord opérationnel.

## Démonstration

- `/` — parcours passager et réservation
- `/driver` — file des demandes et progression chauffeur
- `/operations` — indicateurs, courses récentes, activité et flotte

## Développement local

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/daloago run dev
```

La base PostgreSQL est utilisée par l'API. Les premières données de démonstration sont créées automatiquement si les tables sont vides.

## GitHub et Render

Le dépôt contient une vérification GitHub Actions dans `.github/workflows/ci.yml` et un Blueprint Render dans `render.yaml`.

Le Blueprint crée deux services indépendants :

1. `daloago-api` — API Node/Express, avec `DATABASE_URL` à renseigner dans Render.
2. `daloago-web` — interface statique Vite, configurée par `VITE_API_BASE_URL`.

Après création du service API, vérifier l'URL Render générée et ajuster `VITE_API_BASE_URL` dans le service web si le nom du service a été personnalisé.

### Connexion à Render

1. Connecte le dépôt GitHub contenant DaloaGo à Render.
2. Dans Render, choisis **New > Blueprint** puis sélectionne ce dépôt.
3. Render détectera automatiquement `render.yaml` et proposera les services `daloago-api`, `daloago-web` et la base `daloago-db`.
4. Confirme la création de la base PostgreSQL Render. Le schéma est poussé automatiquement pendant le build de l’API.
5. Lance le déploiement. Le service web utilisera automatiquement `https://daloago-api.onrender.com` comme URL API par défaut.
6. Si Render attribue une autre URL au service API, remplace `VITE_API_BASE_URL` dans les variables du service web puis redéploie le frontend.

Le service API expose la vérification de santé sur `/api/healthz`.

Le plan PostgreSQL gratuit de Render est adapté à une démonstration MVP ; pour la production, choisis un plan de base de données avec sauvegardes et conservation longue durée.