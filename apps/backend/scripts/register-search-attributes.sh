#!/usr/bin/env bash
# Registers the custom search attributes DevSummary workflows set.
# Idempotent: re-running is safe (already-exists errors are ignored).
set -euo pipefail

CONTAINER="${TEMPORAL_ADMIN_CONTAINER:-launchstack-temporal-admin}"
NAMESPACE="${TEMPORAL_NAMESPACE:-default}"

run() {
  docker exec "$CONTAINER" temporal operator search-attribute create \
    --namespace "$NAMESPACE" --name "$1" --type "$2" || \
    echo "  (already exists or benign error for $1)"
}

echo "Registering search attributes on namespace '$NAMESPACE'..."
run OrganizationId Keyword
run Phase Keyword
echo "Done. Current custom search attributes:"
docker exec "$CONTAINER" temporal operator search-attribute list --namespace "$NAMESPACE"
