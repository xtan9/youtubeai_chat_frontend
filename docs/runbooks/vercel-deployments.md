# Vercel deployments

Automatic Vercel Git deployments are disabled to protect the deployment quota.

- Production runs after `CI` and `Database Migration` succeed on `main`.
- Documentation, CI, tests, scripts, and Supabase-only changes do not deploy the frontend.
- Application, content, dependency, public asset, and build-configuration changes deploy.
- Unknown paths or classifier errors deploy fail-open.
- Preview deployments are explicit: run `Vercel Deploy` manually on the desired branch with `target=preview`.
- `CONTROLLED_VERCEL_DEPLOYMENTS=disabled` is the deployment kill switch.
- `VERCEL_TOKEN` is a project-scoped access token. Every Vercel CLI command
  receives it through `--token`; relying on ambient CLI authentication is not
  supported in GitHub Actions.
- The workflow verifies access to `VERCEL_PROJECT_ID` before deploying. Because
  Vercel performs the remote build, the workflow does not need `vercel pull`.

When repository paths move, update and test `scripts/vercel-deployment-policy.mjs` in the same pull request.

When rotating `VERCEL_TOKEN`, scope the replacement to
`youtubeai-chat-frontend`, update the GitHub Actions secret, and manually run a
preview deployment before relying on the next production deployment.
