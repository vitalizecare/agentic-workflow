#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_DOCTOR="$DIR/../../doctor.sh"

# Every test runs a copy of doctor.sh in its own skill layout
# (<skill>/scripts/doctor.sh), so a deployment.env committed next to the real
# SKILL.md (a fork's) never leaks into these tests.
new_skill() {
  local skill; skill="$(mktemp -d)"
  mkdir -p "$skill/scripts"
  cp "$REAL_DOCTOR" "$skill/scripts/doctor.sh"
  echo "$skill"
}

# Fake curl/docker/nc. docker and nc append their argv to <bin>/calls.
setup_fake_bins() {
  local bin_dir="$1" login_html="$2" pg_ready="$3" port_open="$4"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/curl" <<EOF
#!/usr/bin/env bash
echo "$login_html"
EOF
  cat > "$bin_dir/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$*" >> "$bin_dir/calls"
[ "$pg_ready" = "1" ] && exit 0 || exit 1
EOF
  cat > "$bin_dir/nc" <<EOF
#!/usr/bin/env bash
echo "nc \$*" >> "$bin_dir/calls"
[ "$port_open" = "1" ] && exit 0 || exit 1
EOF
  chmod +x "$bin_dir/curl" "$bin_dir/docker" "$bin_dir/nc"
  : > "$bin_dir/calls"
}

# run_doctor <skill> <bin> [VAR=value ...] — a clean environment: no inherited UI_EVIDENCE_* settings.
run_doctor() {
  local skill="$1" bin_dir="$2"; shift 2
  env -i HOME="$HOME" PATH="$bin_dir:/usr/bin:/bin" "$@" bash "$skill/scripts/doctor.sh" 2>&1
}

test_healthy_stack_with_only_a_title_exits_0_and_probes_nothing_unconfigured() {
  local skill bin_dir; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 0 0
  run_doctor "$skill" "$bin_dir" UI_EVIDENCE_APP_TITLE="TestApp" > /dev/null || { echo "FAIL: expected exit 0 with only the title configured"; exit 1; }
  [ ! -s "$bin_dir/calls" ] || { echo "FAIL: expected no docker/nc probe without a configured container or port, got: $(cat "$bin_dir/calls")"; exit 1; }
  echo "PASS: test_healthy_stack_with_only_a_title_exits_0_and_probes_nothing_unconfigured"
}

test_foreign_process_on_3000_is_refused_not_double_driven() {
  local skill bin_dir out; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<html>some other app</html>" 1 1
  if out="$(run_doctor "$skill" "$bin_dir" UI_EVIDENCE_APP_TITLE="TestApp")"; then
    echo "FAIL: expected a non-zero exit when :3000 isn't this app (RF-1)"; exit 1
  fi
  echo "$out" | grep -qi "not.*this app\|foreign" || { echo "FAIL: expected a clear refusal reason, got: $out"; exit 1; }
  echo "PASS: test_foreign_process_on_3000_is_refused_not_double_driven"
}

test_configured_postgres_not_ready_fails_naming_the_container() {
  local skill bin_dir out; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 0 1
  if out="$(run_doctor "$skill" "$bin_dir" UI_EVIDENCE_APP_TITLE="TestApp" UI_EVIDENCE_DB_CONTAINER="db_1")"; then echo "FAIL: expected non-zero when postgres isn't ready"; exit 1; fi
  echo "$out" | grep -q "postgres in container db_1" || { echo "FAIL: expected postgres and the container named in the failure, got: $out"; exit 1; }
  echo "PASS: test_configured_postgres_not_ready_fails_naming_the_container"
}

test_docker_invoked_exactly_once_with_the_configured_container_and_user() {
  local skill bin_dir; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 1 1
  run_doctor "$skill" "$bin_dir" UI_EVIDENCE_APP_TITLE="TestApp" UI_EVIDENCE_DB_CONTAINER="db_1" UI_EVIDENCE_DB_USER="app" > /dev/null
  local calls; calls="$(grep '^docker' "$bin_dir/calls")"
  [ "$calls" = "docker exec db_1 pg_isready -U app" ] || { echo "FAIL: expected one pg_isready in db_1 as app, got: $calls"; exit 1; }
  echo "PASS: test_docker_invoked_exactly_once_with_the_configured_container_and_user"
}

test_configured_api_port_not_open_fails_naming_the_port() {
  local skill bin_dir out; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 1 0
  if out="$(run_doctor "$skill" "$bin_dir" UI_EVIDENCE_APP_TITLE="TestApp" UI_EVIDENCE_API_PORT="5100")"; then echo "FAIL: expected non-zero when the API port isn't open"; exit 1; fi
  echo "$out" | grep -q "api-server (:5100)" || { echo "FAIL: expected the api port named in the failure, got: $out"; exit 1; }
  grep -q "^nc -z localhost 5100$" "$bin_dir/calls" || { echo "FAIL: expected nc on the configured port, got: $(cat "$bin_dir/calls")"; exit 1; }
  echo "PASS: test_configured_api_port_not_open_fails_naming_the_port"
}

test_missing_app_title_config_fails_with_reason() {
  local skill bin_dir out; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 1 1
  if out="$(run_doctor "$skill" "$bin_dir" UI_EVIDENCE_CONFIG="/nonexistent")"; then
    echo "FAIL: expected non-zero when UI_EVIDENCE_APP_TITLE isn't configured"; exit 1
  fi
  echo "$out" | grep -qi "UI_EVIDENCE_APP_TITLE" || { echo "FAIL: expected the missing config var named in the failure, got: $out"; exit 1; }
  echo "PASS: test_missing_app_title_config_fails_with_reason"
}

test_deployment_env_supplies_settings_and_local_file_and_environment_win() {
  local skill bin_dir out; skill="$(new_skill)"; bin_dir="$(mktemp -d)"
  setup_fake_bins "$bin_dir" "<title>Local App</title>" 1 1
  cat > "$skill/deployment.env" <<'EOF'
# committed deployment defaults
UI_EVIDENCE_APP_TITLE="Deployed App"
export UI_EVIDENCE_DB_CONTAINER=deployed_db
UI_EVIDENCE_API_PORT=5002
EOF
  printf 'UI_EVIDENCE_APP_TITLE='"'"'Local App'"'"'\n' > "$skill/.ui-evidence.local.env"
  out="$(run_doctor "$skill" "$bin_dir" UI_EVIDENCE_API_PORT="6000")" || { echo "FAIL: expected the local title to win over deployment.env, got: $out"; exit 1; }
  grep -q "^docker exec deployed_db pg_isready -U postgres$" "$bin_dir/calls" || { echo "FAIL: expected deployment.env's container, got: $(cat "$bin_dir/calls")"; exit 1; }
  grep -q "^nc -z localhost 6000$" "$bin_dir/calls" || { echo "FAIL: expected the environment's port to win, got: $(cat "$bin_dir/calls")"; exit 1; }
  echo "PASS: test_deployment_env_supplies_settings_and_local_file_and_environment_win"
}

test_settings_files_are_parsed_never_executed() {
  local skill bin_dir marker; skill="$(new_skill)"; bin_dir="$(mktemp -d)"; marker="$(mktemp -d)/ran"
  setup_fake_bins "$bin_dir" "<title>TestApp</title>" 1 1
  printf 'touch %s\nUI_EVIDENCE_APP_TITLE=$(touch %s)\n' "$marker" "$marker" > "$skill/deployment.env"
  run_doctor "$skill" "$bin_dir" > /dev/null || true
  [ ! -e "$marker" ] || { echo "FAIL: a settings file line was executed"; exit 1; }
  echo "PASS: test_settings_files_are_parsed_never_executed"
}

test_healthy_stack_with_only_a_title_exits_0_and_probes_nothing_unconfigured
test_foreign_process_on_3000_is_refused_not_double_driven
test_configured_postgres_not_ready_fails_naming_the_container
test_docker_invoked_exactly_once_with_the_configured_container_and_user
test_configured_api_port_not_open_fails_naming_the_port
test_missing_app_title_config_fails_with_reason
test_deployment_env_supplies_settings_and_local_file_and_environment_win
test_settings_files_are_parsed_never_executed
echo "All doctor tests passed."
