#!/usr/bin/env bash
# Updates a BBHS copy from GitHub and restarts it. Installed on the server as /usr/local/bin/bbhs-deploy.
#
#   sudo bbhs-deploy            # live copy, branch from /opt/bbhs-live/.deploy-branch (default: main)
#   sudo bbhs-deploy test       # the test copy
#
# GitHub Actions calls it after every push (see .github/workflows/deploy.yml); it can also be run by hand.
# Keeps .env and the data folder; if the new code does not answer, it goes back to the previous version.
set -euo pipefail

COPY="${1:-live}"
case "$COPY" in live) PORT=4600 ;; test) PORT=4601 ;; *) echo "Unknown copy: $COPY (use live or test)"; exit 1 ;; esac
DIR="/opt/bbhs-$COPY"
BRANCH="$(cat "$DIR/.deploy-branch" 2>/dev/null || echo main)"

cd "$DIR"
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$DIR" || git config --system --add safe.directory "$DIR"
OLD="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH"
NEW="$(git rev-parse "origin/$BRANCH")"
if [ "$OLD" = "$NEW" ]; then echo "Already on $BRANCH ${NEW:0:7}, nothing to do."; exit 0; fi
# Never go backwards: if the server has commits GitHub does not have yet, push them first.
if git merge-base --is-ancestor "$NEW" "$OLD"; then echo "The server (${OLD:0:7}) is ahead of GitHub (${NEW:0:7}); push to GitHub first."; exit 0; fi

git reset --quiet --hard "$NEW"
chown -R bbhs: "$DIR"
systemctl restart "bbhs@$COPY"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/api/bootstrap" >/dev/null 2>&1; then
    echo "Deployed $COPY: ${OLD:0:7} -> ${NEW:0:7} ($(git log -1 --format=%s))"
    exit 0
  fi
done

echo "The new version did not answer on port $PORT; going back to ${OLD:0:7}."
git reset --quiet --hard "$OLD"
chown -R bbhs: "$DIR"
systemctl restart "bbhs@$COPY"
exit 1
