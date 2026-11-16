# Production Deployment

## EC2 deployment with GitHub Actions

The main-branch workflow in [deploy.yaml](../.github/workflows/deploy.yaml) runs the tests, builds the Docker image on GitHub, and transfers the image and tracked source to EC2. The 1 GB EC2 instance does not compile TypeScript.

The live server is Ubuntu at `3.26.18.73`, with the application in `/opt/sunvika-backend`. The public API is `https://sunvikamanagementhub.sunvika.in/api/v1`. DNS must point to this instance and its security group must allow ports 80 and 443. Restrict port 22 to trusted deployment sources.

### GitHub Actions configuration

Configure repository **Settings ? Secrets and variables ? Actions**:

- Required secrets: `EC2_SSH_KEY` (the PEM private-key contents) and `EC2_KNOWN_HOSTS` (the verified host-key entry for this EC2 instance).
- Optional variables: `EC2_HOST` (defaults to `3.26.18.73`), `EC2_USER` (defaults to `ubuntu`), and `PUBLIC_API_URL` (defaults to the live HTTPS API URL). Existing variables and secrets override defaults, so remove or correct values referring to the old instance.
- The SSH user must own the deployment directory and have passwordless sudo for Docker and the release script. The workflow uses `sudo -n`; it does not require membership in the Docker group.

By default, deployment retains the protected `/opt/sunvika-backend/.env.production` already provisioned on EC2. Database, JWT, SMTP, AWS, and frontend configuration therefore remain intact without duplicating credentials into GitHub. The workflow fails clearly if that file is missing. Source archives contain only Git-tracked files; never commit real credentials.

To intentionally replace the production environment from GitHub, set the variable `UPDATE_PRODUCTION_ENV=true` and configure all required runtime secrets and variables first. Required secrets for this mode include `MONGODB_URI` and `JWT_ACCESS_SECRET`; also provide `SMTP_PASSWORD` and both AWS access-key secrets when those services use static credentials. All runtime settings written by the workflow replace their EC2 values, including optional settings. `FRONTEND_URL` and comma-separated `CORS_ORIGINS` must be the deployed frontend's HTTPS origins. One-time `INITIAL_MD_*` bootstrap values are never transferred.

The default S3 region is `ap-southeast-2`, and the bucket is `sunvikapvtltd-media`. Keep credentials in Secrets and non-sensitive settings in Variables. Review variable overrides before enabling environment replacement.

### HTTPS and certificate renewal

The existing certificate lives under `/etc/letsencrypt/live/sunvikamanagementhub.sunvika.in/`. Both the certificate and production environment must exist before deployment. Nginx serves ACME challenges from `/opt/sunvika-backend/acme`, which Docker Compose mounts at `/var/www/certbot`. Certificate issuance uses Certbot's webroot mode with that host path.

The release script installs [reload-nginx.sh](../deploy/certbot/reload-nginx.sh) as a Certbot deploy hook and enables `certbot.timer`. Renewal reloads Nginx without stopping it. Do not install the legacy standalone pre/post stop/start hooks for this webroot setup. Test renewal with:

```sh
sudo certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

Each release waits for app readiness, recreates Nginx to load the transferred config and the current app IP, and checks the public HTTPS health endpoint. A failed readiness or HTTPS check fails the GitHub job.

## Container image

Build from the repository root with `docker build -t sunvika-management-backend:latest .`. The image uses a multi-stage Node 22 Alpine build, installs only production dependencies in the runtime stage, runs as the unprivileged `node` user, and uses `dumb-init` for signal forwarding. It exposes port 5000 and has a readiness health check at `/api/v1/health`.

Run behind a TLS-terminating reverse proxy or load balancer. Configure `PORT` and `API_PREFIX` to match the deployment. The app trusts one proxy hop; place only a trusted proxy directly in front of it and prevent clients from reaching the container port directly.

## Configuration and secrets

Inject settings through the platform secret manager; do not bake `.env` or credentials into the image. Production startup requires HTTPS values for `PUBLIC_API_URL`, `FRONTEND_URL`, and each `CORS_ORIGINS` entry, a non-placeholder `JWT_ACCESS_SECRET`, and TLS for a `mongodb://` connection. `mongodb+srv://` connections enable TLS by default. Set `MONGODB_MAX_POOL_SIZE` to a value that fits the MongoDB cluster's connection budget across all replicas (default 50 per app instance).

Use a dedicated MongoDB database user with only the application database permissions. Keep S3 buckets private and grant the backend's runtime AWS identity (the configured access-key user or EC2 instance role) `s3:PutObject` and `s3:GetObject` on the `employee-profile-images/*`, `customer-document-staging/*`, and `customer-documents/*` prefixes of their configured bucket(s). When using separate buckets, scope each permission to its corresponding bucket and prefixes. Follow [CUSTOMERS.md](CUSTOMERS.md) for the customer-document policy example. Verify the selected bucket exists in `AWS_REGION`; never make it public. Configure SMTP credentials only in the secret manager. Restrict inbound traffic to the reverse proxy and configure the exact frontend origins in `CORS_ORIGINS`.

## Release procedure

1. Build and run `npm test`, `npm run typecheck`, and `npm run build` in CI.
2. Publish the image with an immutable commit or release tag and deploy it to a staging environment.
3. Verify the readiness endpoint, login and refresh flows, uploads, quotation generation, and scoped dashboard/AMC endpoints with staging credentials.
4. Run `npm run seed:system-roles` as a one-off release task when new system permissions are introduced. Run `npm run bootstrap:md` only for the first installation; it refuses a second MD bootstrap. Both scripts are compiled into `dist/scripts` by the image build and can be invoked with the same image and production secrets.
5. Promote the tested image, monitor application logs, MongoDB health, request latency, and S3/email failures, and retain the previous image for rollback.

The API's health endpoint is a readiness check and returns 503 while MongoDB is disconnected. Configure the platform to stop routing traffic to unhealthy containers. The built-in rate limiter uses in-memory storage; use a shared rate-limit store before scaling across replicas if consistent cross-instance limits are required.

## Performance and security checks

Production startup creates the declared Mongoose indexes. Review query plans with representative data using MongoDB `explain('executionStats')`, especially hierarchy-scoped dashboard aggregations, customer lists, due follow-ups, AMC renewals, and schedule queries. Load-test with realistic hierarchy sizes and verify the database pool budget before increasing replicas. This repository does not claim a throughput target without environment-specific load-test results.

The test suite includes pure validation/token unit tests and HTTP integration checks for readiness, authentication, malformed input, security headers, and denied origins. The HTTP integration suite intentionally does not connect to a database; run staging persistence, role/hierarchy access, and S3 tests against disposable infrastructure before release.
