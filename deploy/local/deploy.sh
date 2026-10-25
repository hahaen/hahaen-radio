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
cp "$base/release.env" "$incoming/previous.env"
cp "$base/compose.yaml" "$incoming/previous-compose.yaml"
cp "$base/release.env" "$incoming/next.env"
compose() { docker compose --project-name "$name" --env-file "$1" -f "$2" "${@:3}"; }
set_image() {
  local key=$1 value=$2
  sed -i "/^$key=/d" "$incoming/next.env"
  printf '%s=%s\n' "$key" "$value" >> "$incoming/next.env"
}
if [[ $project == radio ]]; then
  compose "$base/release.env" "$base/compose.yaml" run --rm --no-deps migration status > "$incoming/schema-status.json"
  python3 - "$incoming/schema-status.json" <<'SCHEMA'
import json,sys
status=json.load(open(sys.argv[1]))
assert status.get('event') == 'migration_status' and status.get('pending') == []
SCHEMA
fi
services=()
old_images=()
new_image=
changed=0
web_changed=0
success=0
web_root=
rollback() {
  local status=$?
  trap - EXIT
  if [[ $success == 0 && $changed == 1 ]]; then
    echo 'Release failed; restoring previous containers' >&2
    # Schema migrations are blocked by this entry point for Radio. Ledger uses
    # forward-only Flyway: never attempt a database downgrade here.
    compose "$incoming/previous.env" "$incoming/previous-compose.yaml" up -d --no-build --pull never "${services[@]}" || status=1
    docker exec nginx nginx -t && docker exec nginx nginx -s reload || status=1
  fi
  if [[ $success == 0 && $web_changed == 1 ]]; then
    rm -rf -- "$web_root"
    mv "$incoming/previous-web" "$web_root"
  fi
  exit "$status"
}
trap rollback EXIT
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
  changed=1
  compose "$incoming/next.env" "$incoming/compose.yaml" up -d --no-build --pull never "${services[@]}"
  if [[ $project == radio ]]; then
    for service in "${services[@]}"; do
      if [[ $service == api ]]; then
        ok=0
        for ((i=0; i<60; i++)); do
          if [[ $(docker inspect -f '{{.State.Health.Status}}' radio-api) == healthy ]]; then ok=1; break; fi
          sleep 2
        done
        [[ $ok == 1 ]]
      else
        sleep 5
        [[ $(docker inspect -f '{{.State.Status}} {{.RestartCount}}' radio-jobs) == 'running 0' ]]
      fi
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
  # Copy the prior public files during this transaction only, including symlink targets.
  cp -RL "$web_root" "$incoming/previous-web"
  web_changed=1
  rm -rf -- "$web_root"
  cp -R "$incoming/web" "$web_root"
  chmod -R a+rX "$web_root"
fi
# Validate through the public HTTPS virtual host before committing runtime metadata.
if [[ $project == radio ]]; then
  curl --fail --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 https://hahaen.xyz/radio/api/v1/health/ready >/dev/null
  curl --fail --silent --show-error --resolve hahaen.xyz:443:127.0.0.1 https://hahaen.xyz/radio/ | grep -q '/radio/assets/'
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
for image in "${old_images[@]}"; do
  if [[ -z $(docker ps -aq --filter "ancestor=$image") ]]; then docker image rm "$image" || true; fi
done
if [[ $project == radio && -d $incoming/web ]]; then
  rm -rf -- "$base/web/releases"
fi
# This host no longer compiles source; do not accumulate packaging cache.
docker builder prune -af >/dev/null
printf 'Deployed %s/%s %s; previous artifacts removed\n' "$project" "$scope" "$revision"
