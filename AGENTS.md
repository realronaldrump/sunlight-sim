Read SPEC.md Section 0 before doing anything. You are autonomous. Never ask the owner for anything.

## Branch and deployment policy

- `main` is the only branch, locally and on GitHub. Work directly on `main`; do not create or push feature, release, or deployment branches.
- Every deployment must include committing the changes being deployed and running `git push origin main`. Verify the deployed commit is present on `origin/main` before declaring the deployment complete.
