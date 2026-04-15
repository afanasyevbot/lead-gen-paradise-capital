#!/bin/sh
# Railway cron entrypoint for the weekly Slack report.
#
# Why a script instead of inlining curl in railway.json's startCommand:
# when the command is inlined, Railway's shell wrapper does not reliably
# expand $REPORT_TOKEN, so curl ends up sending the literal string
# "Bearer $REPORT_TOKEN" and the endpoint returns 401. Running via this
# script guarantees a clean /bin/sh expansion.

set -eu

: "${REPORT_TOKEN:?REPORT_TOKEN is not set on the cron service}"

URL="https://pure-art-production-a5e0.up.railway.app/api/admin/weekly-report"

echo "[cron-weekly] POST $URL (token len=${#REPORT_TOKEN})"

HTTP_STATUS=$(curl -sS -o /tmp/resp.txt -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $REPORT_TOKEN" \
  "$URL")

echo "[cron-weekly] HTTP $HTTP_STATUS"
echo "[cron-weekly] body: $(cat /tmp/resp.txt)"

if [ "$HTTP_STATUS" != "200" ]; then
  echo "[cron-weekly] non-200, failing"
  exit 1
fi

echo "[cron-weekly] OK"
