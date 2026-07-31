# Vercel deployments

Automatic Vercel Git deployments are disabled to protect the deployment quota.

- Production runs after `CI` and `Database Migration` succeed on `main`.
- Documentation, CI, tests, scripts, and Supabase-only changes do not deploy the frontend.
- Application, content, dependency, public asset, and build-configuration changes deploy.
- Unknown paths or classifier errors deploy fail-open.
- Preview deployments are explicit: run `Vercel Deploy` manually on the desired branch with `target=preview`.
- `CONTROLLED_VERCEL_DEPLOYMENTS=disabled` is the deployment kill switch.

When repository paths move, update and test `scripts/vercel-deployment-policy.mjs` in the same pull request.
