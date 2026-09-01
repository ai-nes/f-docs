# F-Doc deployment

## Target

Self-hosted Docker Compose on `100.75.51.122`.

The application listens on port `3000`. Put a reverse proxy with HTTPS in front of it before exposing it to the public internet.

## First-time server setup

1. Create `/home/oral/f-doc`.
2. Copy `.env.prod.example` to `/home/oral/f-doc/.env.prod`.
3. Replace `APP_SECRET` and `POSTGRES_PASSWORD` with unique random values, then run `chmod 600 /home/oral/f-doc/.env.prod`.
4. Add the server's SSH public key to the GitHub repository secrets as `DEPLOY_SSH_KEY`; add `DEPLOY_HOST`, `DEPLOY_USER`, and optionally `DEPLOY_PORT`.
5. Ensure the `oral` user can run Docker without `sudo`.

`BUILD_APP_ID` and `BUILD_APP_PRIVATE_KEY` are already required by the release workflow because the repository has a private submodule. The deploy workflow uses the same credentials to build the image.

## CI/CD

`.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatch:

1. Builds the amd64 production image in GitHub Actions.
2. Uploads the image as a short-lived artifact.
3. Copies the image and production Compose file to the server over SSH.
4. Runs database migrations before starting the new application container.
5. Checks `/api/health/live`.

Required GitHub secrets:

- `BUILD_APP_ID`
- `BUILD_APP_PRIVATE_KEY`
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PORT` (optional; defaults to `22`)

## Operations

```bash
cd /home/oral/f-doc
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f f-doc
```

Back up the `db_data` and `f-doc` volumes independently. Docker volumes alone are not a backup strategy.
