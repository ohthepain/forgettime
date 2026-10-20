# Forgettime deployment

The project follows the existing Logmaster deployment shape: Node 22, pnpm 9.15.4, TanStack Start with a Hono Node adapter on port 3000, Drizzle/PostgreSQL, Better Auth, ARM64 ECS Fargate, ECR, and project-specific SSM SecureString parameters. The mobile UI is the same hosted web app inside Capacitor 8; native capture lives in the plugin.

## Ownership and inputs

Forgettime consumes the existing `shared-aws` default-workspace state at `shared/terraform.tfstate`. It reads `vpc_id`, `public_subnet_ids`, `alb_security_group_id`, `https_listener_arn`, `alb_dns_name`, `rds_endpoint`, `rds_port`, `rds_master_secret_arn`, `ops_cluster_name`, and `ops_security_group_id`. Their names are checked against the local shared-aws source; no account resources were inspected or changed during setup.

Shared-aws remains the sole Terraform owner of VPC, ALB/listener, RDS, shared security groups, and the ops cluster. Forgettime owns only its ECS service/cluster/task definitions, ECR repository, target group/host rule, optional certificate attachment, task security group, IAM roles, logs, and SSM parameters. Each environment has a distinct database and role, `forgettime_staging` or `forgettime_production`. The role/database is created by a separate one-shot task and is not owned by a PostgreSQL Terraform resource.

Provide the following before any deployment:

- Existing state bucket and DynamoDB lock table, plus the shared-state bucket.
- Public hostname, existing ACM certificate in the AWS region, and a coordinated unused ALB listener priority. Example files deliberately have invalid placeholders, not guessed allocations.
- DNS CNAME/alias from that hostname to the `shared_alb_dns_name` output.
- AWS credentials with the necessary tenant-resource permissions. Bootstrap infrastructure access and routine application deployment access should be separate roles.
- Optional Google OAuth credentials in project-specific SSM SecureStrings, with callback `https://YOUR_HOST/api/auth/callback/google` and both parameter ARNs configured.
- A verified SES identity and `ses_from_email` before enabling verification/password-reset mail. Set `auth_require_email_verification = true` when registration must verify addresses.

Use `attach_alb_certificate = false` when this exact certificate attachment is already owned by another state; do not import or double-own a shared attachment. No shared resource imports are required.

SSM uses the account's default AWS-managed key. If existing optional secrets or the shared master secret use a customer-managed KMS key, add a narrowly scoped `kms:Decrypt` grant and compatible key policy to the relevant execution role before use. The application role cannot retrieve shared master credentials. Only the separate database-setup execution role can inject them into the setup container. The setup command contains no credential values; ECS injects them at task launch. See [AWS ECS parameter injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html).

Terraform state and saved plans contain generated application secrets even though they are not printed as outputs. Protect the state bucket with encryption, versioning, and restricted access; keep ignored `.tfplan`, `.tfvars`, and `backend.hcl` files private. Access to shared remote state also gives access to its full state snapshot, so restrict deployment identities accordingly. Do not regenerate the random database password or change the SSM URL without coordinating a database password rotation; the setup task intentionally will not rotate an existing role.

## First deployment

Commit the project source before building deployment images; the deploy helper requires a clean working tree so its Git SHA tag identifies the source. Run from the repository root, using the required configured AWS profile/session. Commands below create real AWS resources only when you choose to run them.

```sh
cp terraform/backend.hcl.example terraform/backend.hcl
cp terraform/environments/staging/terraform.tfvars.example terraform/environments/staging/terraform.tfvars
# Edit both files. Leave ecs_desired_count = 0 initially.
scripts/tf-init.sh staging
scripts/tf-plan.sh staging
# Review the plan printed above. This asks for the exact environment name.
scripts/tf-apply.sh staging
scripts/deploy-provision-db.sh staging
scripts/deploy.sh staging --push-only
# Set ecs_desired_count = 1 in the staging tfvars.
scripts/tf-plan.sh staging
scripts/tf-apply.sh staging
```

The Forgettime backend key is `forgettime/app/terraform.tfstate`, with separate staging/production Terraform workspaces. Always select the environment through the helper scripts; preconditions reject a mismatched workspace. Repeat onboarding for production with its own hostname, listener priority, OAuth configuration, and workspace.

The provisioning task uses the shared ops cluster and subnets. It creates a role/database only when absent, verifies database ownership, and then tests a connection using the tenant credentials. Existing passwords and data are preserved. PostgreSQL 18 requires the provisioning administrator to have SET membership in a newly created tenant role before assigning database ownership; the script grants only that membership when necessary. An owner or password mismatch fails for investigation. Do not replace this with the older shared-aws provision helper: the inspected version of that helper drops and recreates an existing tenant database. SQL uses [psql environment variables and conditional execution](https://www.postgresql.org/docs/18/app-psql.html), with `ON_ERROR_STOP` enabled.

The app container runs `pnpm db:migrate:deploy` inside the VPC before listening. Schema migrations must be backward-compatible with the previously running app: ECS keeps the old healthy task while starting the new one. A migration failure prevents the new app from starting. The container includes the AWS RDS trust bundle and sets `NODE_EXTRA_CA_CERTS`; the database URL requires TLS. The separate PostgreSQL setup image uses `sslmode=require` (encrypted transport; no explicit custom RDS CA/hostname verification in that one-shot image).

After initial activation, verify the ECS deployment/events, `/api/healthz`, registration/sign-in, email if enabled, and microphone permission from the final HTTPS origin. A healthy HTTP response alone does not validate auth/database access or audio accuracy.

## CI and releases

`ci.yml` runs dependency installation, Drizzle migration generation, typecheck, tests, production build, Terraform formatting/validation without a backend, and shell syntax checks. PR CI needs no AWS credentials.

`android-build.yml` runs Capacitor sync and an Android debug build with Java 21. Its `https://ci.invalid` URL is explicitly a compile fixture; the downloadable APK is not a working hosted app and does not validate physical-device microphone behavior.

`android-release.yml` manually builds a signed AAB for a configured HTTPS origin and explicit version code. It stores the bundle as a repository artifact and does not upload to Google Play. The production GitHub environment needs `CAP_REMOTE_APP_URL`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Keep the upload keystore backed up outside the repository and coordinate the application ID before first Play publication.

`deploy.yml` deploys staging on every push to `dev`, and can still be started manually for staging or production. It validates the selected revision, builds ARM64, pushes environment and commit-SHA image tags, forces an ECS deployment, waits for completion, rejects rollback masquerading as success, and checks the HTTPS health endpoint. It never runs Terraform apply or provisions a database. Initial infrastructure must already be activated, and the ECS service desired count must already be at least 1. Use GitHub environment protection rules for staging/production, especially a required reviewer and main-only production deployments; a YAML environment name alone does not enforce approval. The workflow reads Terraform state at `forgettimeapp/terraform.tfstate`, matching `terraform/backend.hcl`.

Configure these GitHub environment secrets:

| Secret/variable | Meaning |
| --- | --- |
| `AWS_ROLE_ARN_DEPLOY` (secret) | OIDC role trusted for this repository and environment |
| `AWS_TF_STATE_BUCKET` (secret) | Existing bucket containing Forgettime's state |
| `AWS_TF_LOCK_TABLE` (secret) | Existing state lock table |
| `AWS_REGION` (variable, optional) | Defaults to `eu-central-1`; must match the applied stack |

The routine deploy role needs state read/backend-lock access, ECR authentication/push to this environment's repository, ECS describe/update on its service, and the normal role's OIDC trust. It does not need Terraform create/delete permissions or shared RDS credentials. Keep Terraform apply and database provisioning under a separately authorized operator identity. A push to `dev` deploys staging only. Production stays on manual dispatch.

`staging-up.yml`, `staging-down.yml`, `production-up.yml`, and `production-down.yml` are manual Actions that scale the existing ECS service (`forgettime-<env>-cluster` / `forgettime-<env>-service`) using the same `AWS_ROLE_ARN_DEPLOY` role. Staging down also runs on a schedule at 19:00 and 22:00 UTC. They do not apply Terraform and they do not start or stop shared RDS. They only succeed after that environment's ECS service has been applied at least once. Scaling to zero does not change `ecs_desired_count` in tfvars; the next Terraform apply restores the count from state.

The ECS task consumes the mutable environment image tag, matching the existing deployment convention. The commit-SHA tag records rollback candidates. For rollback, retag/push a known compatible SHA as the environment tag and force a new deployment; database migrations are not automatically reverted. Investigate failed migrations before rolling code back. Image retention currently removes only untagged images, preserving tagged rollback candidates.

## Local database

`docker compose up -d` starts PostgreSQL 18, matching the shared RDS major version, bound only to `127.0.0.1:5434`. Local-only credentials/database are `forgettime`/`forgettime`/`forgettime`.

```text
postgresql://forgettime:forgettime@localhost:5434/forgettime
```

The persistent volume is isolated from other projects. PostgreSQL 18 mounts `/var/lib/postgresql`; do not point it at an older major-version data directory. Use `pnpm db:migrate:deploy` for committed migrations.

## Validation boundary

`scripts/test-database-provisioning.sh` runs against a disposable PostgreSQL 18 Docker container with no published port or persistent volume. It checks fresh provisioning, a repeated run preserving a marker row, incorrect-password rejection, and incorrect-owner rejection. Terraform formatting and provider validation, shell syntax, and Compose parsing can also be checked locally without AWS. They do not verify live listener-priority availability, ACM/DNS ownership, IAM trust/permissions, the current shared state, Fargate image pulls, or a deployed RDS connection. No AWS apply, DNS change, OAuth registration, app-store upload, or deployment was performed while creating this scaffold.

## Drizzle migration baseline

The committed `drizzle/0000_initial_auth.sql` creates the four auth tables on fresh databases and adopts the unchanged tables created by the former Prisma migration. It preserves table/column names, timestamp precision, indexes and cascade behavior, and never drops tables or data. Existing `_prisma_migrations` records may remain unused; Drizzle keeps its own journal in `drizzle.__drizzle_migrations`. This baseline assumes the original Forgettime schema, not arbitrary schema drift. No manual reset is required for the previous empty database.

For subsequent changes, edit `src/server/schema.ts`, run `pnpm db:generate`, review and commit the SQL plus metadata, then deploy. Builds consume the TypeScript schema directly and do not generate migrations. CI checks that migration generation leaves committed metadata unchanged and exercises auth on both a fresh PostgreSQL database and the previous schema.
