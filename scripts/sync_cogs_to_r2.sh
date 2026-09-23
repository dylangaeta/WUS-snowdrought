#!/usr/bin/env bash
# Sync the local cogs/ and data/ staging directories (written by the
# snowdrought-carbon pipeline's export scripts) to the Cloudflare R2 bucket
# that serves them to the live dashboard -- js/common.js's assetUrl() points
# at this same bucket for both. cogs/ is large binary data, too big for git;
# data/ is small individually but gets fully rewritten on every pipeline
# export, so committing it to git grows repo history forever with no way to
# reclaim the space (moved out of git 2026-09, see .gitignore).
#
# (figures/maps/ and figures/synthesis|heatmaps/ -- static per-product map
# and chart PNGs -- no longer need syncing: every dashboard page now
# computes its own charts/maps client-side, so nothing reads figures/
# anymore. Removed here 2026-09.)
#
# R2 is not AWS -- this just reuses the aws-cli as a generic S3-compatible
# client pointed at R2's own endpoint, since R2 speaks the S3 API.
#
# Requires four environment variables, set in your own shell (never
# hardcoded here or passed on the command line):
#   R2_ACCOUNT_ID        Cloudflare dashboard > R2 > Overview (right side)
#   R2_ACCESS_KEY_ID      Cloudflare dashboard > R2 > Manage API Tokens > Create API Token
#   R2_SECRET_ACCESS_KEY  (shown once when the token is created -- save it then)
#   R2_BUCKET             the bucket name, e.g. wus-snowdrought
set -euo pipefail

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
: "${R2_BUCKET:?set R2_BUCKET}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 sync "$REPO_DIR/cogs/" "s3://$R2_BUCKET/cogs/" \
  --endpoint-url "$ENDPOINT" \
  --content-type "image/tiff"
echo "synced $REPO_DIR/cogs/ -> s3://$R2_BUCKET/cogs/"

AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 sync "$REPO_DIR/data/" "s3://$R2_BUCKET/data/" \
  --endpoint-url "$ENDPOINT"
echo "synced $REPO_DIR/data/ -> s3://$R2_BUCKET/data/"
