#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project=$1 scope=$2 revision=$3 incoming=$4
[[ $project == radio || $project == ledger ]]
[[ $revision =~ ^[a-f0-9]{40}$ ]]
[[ $incoming == /tmp/"$project"-upload.* && -d $incoming && ! -L $incoming ]]
if [[ $project == radio ]]; then
  [[ $scope == api || $scope == jobs || $scope == frontend || $scope == all ]]
  base=/home/hahaen/hahaen-radio
  name=radio
else
  [[ $scope == backend || $scope == h5 || $scope == all ]]
  base=/home/hahaen/ledger-runtime
  name=hahaen-ledger
fi
mkdir -p "$base"
exec 9>"$base/release.lock"
flock -n 9 || { echo 'Another release is running' >&2; exit 1; }
[[ -s $base/compose.yaml && -s $base/release.env ]] || { echo 'Initialize stable runtime configuration first' >&2; exit 1; }
if [[ $project == ledger ]]; then
  cp "$base/release.env" "$incoming/previous.env"
  cp "$base/compose.yaml" "$incoming/previous-compose.yaml"
fi
cp "$base/release.env" "$incoming/next.env"
compose() { docker compose --project-name "$name" --env-file "$1" -f "$2" "${@:3}"; }
set_image() {
  local key=$1 value=$2
  sed -i "/^$key=/d" "$incoming/next.env"
  printf '%s=%s\n' "$key" "$value" >> "$incoming/next.env"
}
services=()
old_images=()
new_image=
changed=0
web_changed=0
success=0
web_root=
staged_web=
api_result=NOT_REQUESTED
jobs_result=NOT_REQUESTED
frontend_result=NOT_REQUESTED
if [[ $project == radio ]]; then
  [[ $scope != api && $scope != all ]] || api_result=NOT_COMPLETED
  [[ $scope != jobs && $scope != all ]] || jobs_result=NOT_COMPLETED
  [[ $scope != frontend && $scope != all ]] || frontend_result=NOT_COMPLETED
fi
finish() {
  local status=$?
  trap - EXIT
  if [[ $project == radio ]]; then
    [[ -z $staged_web ]] || rm -rf -- "$staged_web"
    if [[ $success == 0 ]]; then
      echo 'Release failed; no previous version was backed up or restored. Check running services before retrying.' >&2
    fi
    printf 'Release result frontend: %s\nRelease result radio-api: %s\nRelease result radio-jobs: %s\nRequested revision: %s\n' "$frontend_result" "$api_result" "$jobs_result" "$revision"
    exit "$status"
  fi
  if [[ $success == 0 && $changed == 1 ]]; then
    echo 'Release failed; restoring previous containers' >&2
    # Ledger uses forward-only Flyway: never attempt a database downgrade here.
    compose "$incoming/previous.env" "$incoming/previous-compose.yaml" up -d --no-build --pull never "${services[@]}" || status=1
    docker exec nginx nginx -t && docker exec nginx nginx -s reload || status=1
  fi
  if [[ $success == 0 && $web_changed == 1 ]]; then
    rm -rf -- "$web_root"
    mv "$incoming/previous-web" "$web_root"
  fi
  exit "$status"
}
trap finish EXIT
if [[ $project == radio ]]; then
  compose "$base/release.env" "$base/compose.yaml" run --rm --no-deps migration status > "$incoming/schema-status.json"
  python3 - "$incoming/schema-status.json" <<'SCHEMA'
import json,sys
status=json.load(open(sys.argv[1]))
assert status.get('event') == 'migration_status' and status.get('pending') == []
SCHEMA
fi
if [[ $project == radio && $scope != frontend ]]; then
  cmp -s "$incoming/migrations.sha256" "$base/migrations.sha256" || { echo 'Database migrations changed: run the reviewed backup/migration workflow before release' >&2; exit 1; }
  [[ $scope == all || $scope == api ]] && services+=(api)
  [[ $scope == all || $scope == jobs ]] && services+=(jobs)
  image_repo=hahaen/radio-runtime
  for service in "${services[@]}"; do old_images+=("$(docker inspect -f '{{.Image}}' "radio-$service")"); done
elif [[ $project == ledger && $scope != h5 ]]; then
  cmp -s "$incoming/migrations.sha256" "$base/migrations.sha256" || { echo 'Database migrations changed: complete reviewed migration workflow first' >&2; exit 1; }
  services=(haji-server)
  image_repo=hahaen/haji-server
  old_images+=("$(docker inspect -f '{{.Image}}' haji-server)")
fi
if ((${#services[@]})); then
  new_image="$image_repo:$revision-$(date +%s)-$$"
  docker build --platform linux/amd64 --no-cache --build-arg "VCS_REF=$revision" -t "$new_image" "$incoming"
  if [[ $project == radio ]]; then
    docker run --rm --network none --read-only --entrypoint node "$new_image" --input-type=module -e 'await import("./dist/app.js");await import("node-cron");await import("./dist/db/schema.js")'
    for service in "${services[@]}"; do
      [[ $service == api ]] && set_image HAEN_API_IMAGE "$new_image"
      [[ $service == jobs ]] && set_image HAEN_JOBS_IMAGE "$new_image"
    done
  else
    set_image HAJI_IMAGE "$new_image"
  fi
  compose "$incoming/next.env" "$incoming/compose.yaml" config --quiet
  if [[ $project == radio ]]; then
    # Keep the attempted runtime configuration available if deployment fails.
    install -m 600 "$incoming/next.env" "$base/release.env"
    install -m 600 "$incoming/compose.yaml" "$base/compose.yaml"
  fi
  changed=1
  if [[ $project == radio ]]; then
    [[ $scope != api && $scope != all ]] || api_result=UNVERIFIED
    [[ $scope != jobs && $scope != all ]] || jobs_result=UNVERIFIED
  fi
  compose "$incoming/next.env" "$incoming/compose.yaml" up -d --no-build --pull never "${services[@]}"
  if [[ $project == radio ]]; then
    for service in "${services[@]}"; do
      if [[ $service == api ]]; then
        ok=0
        for ((i=0; i<60; i++)); do
          if [[ $(docker inspect -f '{{.State.Health.Status}}' radio-api) == healthy ]]; then ok=1; break; fi
          sleep 2
        done
        [[ $ok == 1 ]] || { echo 'API health check failed' >&2; exit 1; }
      else
        sleep 5
        [[ $(docker inspect -f '{{.State.Status}} {{.RestartCount}}' radio-jobs) == 'running 0' ]] || { echo 'Jobs health check failed' >&2; exit 1; }
      fi
      [[ $(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "radio-$service") == "$revision" ]] || { echo "Revision mismatch: radio-$service" >&2; exit 1; }
      [[ $service != jobs ]] || jobs_result=SUCCESS
    done
  else
    ok=0
    for ((i=0; i<90; i++)); do
      if docker exec haji-server bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET /api/app/accounts HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; head -c 16384 <&3' 2>/dev/null | grep -q '^HTTP/1.[01] 401'; then ok=1; break; fi
      sleep 2
    done
    [[ $ok == 1 ]]
  fi
  docker exec nginx nginx -t
  docker exec nginx nginx -s reload
fi
if [[ -d $incoming/web ]]; then
  if [[ $project == radio ]]; then web_root="$base/web/current"; else web_root=/home/hahaen/nginx/html/haji; fi
  [[ -s $incoming/web/index.html && -e $web_root ]]
  if [[ $project == radio ]]; then
    # Prepare the new files before removing the live directory; never copy old files.
    staged_web=$(mktemp -d "$base/web/.incoming.XXXXXXXX")
    cp -R "$incoming/web/." "$staged_web/"
    chmod -R a+rX "$staged_web"
    frontend_result=UNVERIFIED
    rm -rf -- "$web_root"
    mv "$staged_web" "$web_root"
    staged_web=
  else
    cp -RL "$web_root" "$incoming/previous-web"
    web_changed=1
    rm -rf -- "$web_root"
    cp -R "$incoming/web" "$web_root"
    chmod -R a+rX "$web_root"
  fi
fi
# Validate through the public HTTPS virtual host before recording release success.
if [[ $project == radio ]]; then
  curl --fail --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 https://hahaen.xyz/radio/api/v1/health/ready >/dev/null
  [[ $api_result != UNVERIFIED ]] || api_result=SUCCESS
  curl --fail --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 https://hahaen.xyz/radio/ > "$incoming/frontend-check.html"
  grep -q '/radio/assets/' "$incoming/frontend-check.html"
  if [[ $frontend_result == UNVERIFIED ]]; then
    cmp -s "$incoming/web/index.html" "$incoming/frontend-check.html" || { echo 'Public frontend does not match uploaded artifact' >&2; exit 1; }
    frontend_result=SUCCESS
  fi
else
  [[ $(curl --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 -o "$incoming/api-check.json" -w '%{http_code}' https://hahaen.xyz/haji-api/api/app/accounts) == 401 ]]
  grep -q '"code":1,' "$incoming/api-check.json"
  curl --fail --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 https://hahaen.xyz/haji/ | grep -q '<html'
fi
install -m 600 "$incoming/next.env" "$base/release.env"
install -m 600 "$incoming/compose.yaml" "$base/compose.yaml"
printf '%s %s %s\n' "$scope" "$revision" "$(date -Is)" > "$base/latest-release.txt"
success=1
if [[ $project == radio && ( $scope == api || $scope == all ) && -f $base/backup-version/current ]]; then
  # Keep the existing backup helper's application revision aligned with the API.
  printf '%s\n' "$revision" > "$base/backup-version/current"
fi
# Remove only old images from the selected services, after success. Shared images
# still used by another container remain. Never prune volumes or unrelated images.
for image in "${old_images[@]-}"; do
  [[ -n $image ]] || continue
  if [[ -z $(docker ps -aq --filter "ancestor=$image") ]]; then docker image rm "$image" || true; fi
done
if [[ $project == radio && -d $incoming/web ]]; then
  rm -rf -- "$base/web/releases"
fi
# This host no longer compiles source; do not accumulate packaging cache.
docker builder prune -af >/dev/null
printf 'Deployed %s/%s %s; previous artifacts removed\n' "$project" "$scope" "$revision"
