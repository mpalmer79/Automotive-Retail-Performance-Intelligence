#!/bin/sh
# =============================================================================
# ARPI database provisioning — the one-time Railway job's entry point
# =============================================================================
# Builds the ARPI schema in the Railway PostgreSQL database, creates the
# documented role boundary, loads the deterministic `development` profile, proves
# the result, and exits.
#
# SAFE TO RERUN. Every step is idempotent:
#   - the SQL sequence is idempotent by design (sql/README.md), and re-running it
#     prints "already exists, skipping" rather than failing
#   - the login roles are created only when absent, and their passwords are SET
#     from Railway's generated values rather than rotated by this script
#   - the loader's Type 1 upserts fire only where an attribute differs and its
#     Type 2 merges only where an attribute_hash changes, so a second run writes
#     zero warehouse rows
#   - nothing here drops, truncates or recreates anything
#
# `sql/99_local_reset.sql` is present in the image and is NEVER invoked. It DROPs
# every ARPI schema, and it refuses to run unless the database name begins
# `arpi_` — Railway's database is called `railway`, so the guard already rejects
# it. Leave it that way.
#
# NO PASSWORD IS EVER PRINTED.
# The two role passwords arrive as Railway-generated variables. They are passed to
# `psql` through a here-document read on stdin, never as an argument and never
# through `echo`, and `set -x` is never enabled. ARPI's own configuration layer
# holds the loader password as a SecretStr and renders it as ***REDACTED*** in
# every log line.
#
# POSIX `sh`, not bash: the image is Debian slim, where /bin/sh is dash.
# =============================================================================

# `-e` exit on error, `-u` fail on an unset variable. NOT `-x`: tracing would
# print every expanded command, including the ones carrying a password.
set -eu

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

PROFILE="${ARPI_PROFILE:-development}"
MODE="${ARPI_PROVISION_MODE:-converge}"

printf 'ARPI database provisioning\n'
printf '  profile        : %s\n' "$PROFILE"
printf '  mode           : %s\n' "$MODE"
printf '  connection     : resolved from Railway reference variables; never printed\n'

# ---------------------------------------------------------------------------
# 0. Required inputs
#
# Presence is checked, values are not printed. Each of these is a Railway
# reference or generated variable declared in .railway/railway.ts; a missing one
# means the service was not configured by `railway config apply`.
# ---------------------------------------------------------------------------
step 'Checking required variables are present'
for required in PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD \
                ARPI_PIPELINE_PASSWORD ARPI_FABRIC_PASSWORD; do
    eval "value=\${$required:-}"
    [ -n "${value:-}" ] || fail "$required is not set. This service's variables come from
  .railway/railway.ts via 'railway config apply'. Run the bootstrap workflow."
    printf '  [ ok ] %s is set\n' "$required"
done

# TLS is required, not preferred. `verify-full` is deliberately not used: Railway
# issues the certificate for its own Postgres image and the private-network
# hostname is not in it, so `verify-full` would fail on a connection that is in
# fact encrypted. `require` gets encryption; section 4 of
# docs/cloud-database-setup.md records the same reasoning.
export PGSSLMODE="${ARPI_DATABASE__SSLMODE:-require}"
export PGCONNECT_TIMEOUT=30
# `psql` must never stop for input in a container with no terminal.
export PGOPTIONS="${PGOPTIONS:-}"

PSQL="psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc"

# ---------------------------------------------------------------------------
# 1. Wait for PostgreSQL to accept connections
#
# The job and the database deploy at the same time, so the database is routinely
# not ready when this starts. A retry loop is the difference between a job that
# works and one that fails on first deploy and succeeds on a manual redeploy.
# ---------------------------------------------------------------------------
step 'Waiting for PostgreSQL'
attempt=0
until pg_isready -q -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || fail 'PostgreSQL did not accept connections within 5 minutes.'
    sleep 5
done
printf '  [ ok ] accepting connections after %s attempt(s)\n' "$((attempt + 1))"

# ---------------------------------------------------------------------------
# 2. Prove the session is actually encrypted
#
# `PGSSLMODE=require` is a request, not evidence. `pg_stat_ssl` describes the
# session that was actually opened, which is the only thing worth asserting —
# and it is asserted BEFORE any credential is created over this connection.
# ---------------------------------------------------------------------------
step 'Verifying TLS on this session'
ssl_state="$($PSQL -tAc \
    'SELECT ssl::text || $$ $$ || coalesce(version, $$-$$) FROM pg_stat_ssl WHERE pid = pg_backend_pid()')"
case "$ssl_state" in
    true*) printf '  [ ok ] session is encrypted: %s\n' "$ssl_state" ;;
    *)     fail "the session is NOT encrypted (pg_stat_ssl reports '$ssl_state').
  Refusing to create a login role over an unencrypted connection." ;;
esac

# ---------------------------------------------------------------------------
# 3. Confirm the bootstrap role can create roles
#
# A managed provider does not give a superuser. What the three-role model needs is
# CREATEROLE; without it sql/07_security/00_roles.sql fails part-way and leaves a
# database with no security model, which is worse than one that was never built.
# Checked first so the failure names the cause.
# ---------------------------------------------------------------------------
step 'Checking the bootstrap role'
role_report="$($PSQL -tAc \
    "SELECT rolsuper::text || $$/$$ || rolcreaterole::text FROM pg_roles WHERE rolname = current_user")"
printf '  [ ok ] superuser/createrole = %s\n' "$role_report"
case "$role_report" in
    */true) : ;;
    *) fail "the connecting role holds neither superuser nor CREATEROLE, so the three-role
  separation cannot be created. That separation IS the security model, and a
  deployment without it is not this deployment." ;;
esac

# ---------------------------------------------------------------------------
# 4. The ordered SQL sequence
#
# The same sequence as sql/README.md section 2 and tests/integration/conftest.py:
#   * the glob is sql/0*/*.sql, which cannot match sql/99_local_reset.sql
#   * 07_security/02_role_verification.sql is a read-only operator report, not a
#     build step, so it is excluded from the main pass
#   * 07_security/01_grants.sql runs AGAIN as the final step, because the objects
#     created by 08_validation would otherwise stay owned by the bootstrap role
#     instead of arpi_admin — and on a managed provider that second pass is
#     load-bearing, not tidiness: skip it and arpi_reporter either loses SELECT on
#     part of the reporting layer or holds privileges the model forbids
# ---------------------------------------------------------------------------
step 'Running the ordered SQL sequence'
sequence=/tmp/arpi_sql_sequence.txt
find sql/0* -name '*.sql' -type f \
    ! -path 'sql/07_security/02_role_verification.sql' \
    | LC_ALL=C sort > "$sequence"
printf 'sql/07_security/01_grants.sql\n' >> "$sequence"

count=0
while IFS= read -r script; do
    count=$((count + 1))
    $PSQL -f "$script" || fail "$script failed."
done < "$sequence"
printf '  [ ok ] %s script(s) applied\n' "$count"

# ---------------------------------------------------------------------------
# 5. The two login roles
#
# arpi_admin, arpi_loader and arpi_reporter are NOLOGIN GROUP roles created by
# sql/07_security/00_roles.sql. They hold privileges; they cannot open a
# connection. That is what stops a semantic model reaching raw, staging,
# warehouse or audit.
#
# A login role is granted membership in one of them. Two logins, two blast radii:
#   arpi_pipeline -> arpi_loader    writes raw and warehouse, cannot read reporting-only
#   arpi_fabric   -> arpi_reporter  reads the reporting schema and nothing else
#
# The passwords are Railway-generated. They are interpolated inside a here-document
# fed to psql on stdin, so they never appear in an argument list, in `ps`, or in
# this script's output. `\set` is not used because psql echoes variable values in
# some error paths.
#
# CREATE ROLE is guarded by a DO block rather than attempted-and-ignored, so a
# rerun neither errors nor rotates a password that a Fabric connection is already
# using. ALTER ROLE ... PASSWORD is applied every run so that the database and
# Railway's stored value cannot drift apart — that is convergence, not rotation:
# the value being set is the same value Railway already holds.
# ---------------------------------------------------------------------------
step 'Creating the login roles'
$PSQL <<SQL || fail 'login role creation failed.'
DO \$pipeline\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arpi_pipeline') THEN
        CREATE ROLE arpi_pipeline LOGIN INHERIT;
        RAISE NOTICE 'Created role arpi_pipeline.';
    ELSE
        RAISE NOTICE 'Role arpi_pipeline already exists, skipping.';
    END IF;
END
\$pipeline\$;

DO \$fabric\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arpi_fabric') THEN
        CREATE ROLE arpi_fabric LOGIN INHERIT;
        RAISE NOTICE 'Created role arpi_fabric.';
    ELSE
        RAISE NOTICE 'Role arpi_fabric already exists, skipping.';
    END IF;
END
\$fabric\$;

ALTER ROLE arpi_pipeline PASSWORD '${ARPI_PIPELINE_PASSWORD}';
ALTER ROLE arpi_fabric   PASSWORD '${ARPI_FABRIC_PASSWORD}';

-- INHERIT is the default and is what is wanted: the login picks up the group's
-- privileges with no SET ROLE in the connection string. Without it the semantic
-- model would connect successfully and then find it can read nothing.
GRANT arpi_loader   TO arpi_pipeline;
GRANT arpi_reporter TO arpi_fabric;
SQL
printf '  [ ok ] arpi_pipeline -> arpi_loader, arpi_fabric -> arpi_reporter\n'
printf '  [ ok ] passwords set from Railway-generated values; not printed, not rotated\n'

# ---------------------------------------------------------------------------
# 6. Load the deterministic profile
#
# Run as arpi_pipeline, not as the bootstrap role: the three-role separation is
# only real if it is used. The profile fixes seed 20250701 and the window
# 2025-07-01..2025-12-31 in config/development.yaml, so this produces
# byte-identical data to a local run.
# ---------------------------------------------------------------------------
step "Loading the $PROFILE profile"
ARPI_DATABASE__ENABLED=true \
ARPI_DATABASE__HOST="$PGHOST" \
ARPI_DATABASE__PORT="$PGPORT" \
ARPI_DATABASE__NAME="$PGDATABASE" \
ARPI_DATABASE__USER=arpi_pipeline \
ARPI_DATABASE__PASSWORD="${ARPI_PIPELINE_PASSWORD}" \
ARPI_DATABASE__SSLMODE="$PGSSLMODE" \
    arpi run-foundation --profile "$PROFILE" --load-database \
    || fail 'the pipeline run failed. Nothing was dropped; the run is safe to repeat.'
printf '  [ ok ] pipeline run complete\n'

# ---------------------------------------------------------------------------
# 7. Structural verification
#
# Counts read from the database rather than asserted from a document, so a
# sequence that stopped early cannot pass.
# ---------------------------------------------------------------------------
step 'Verifying structure'
schemas="$($PSQL -tAc "SELECT count(*) FROM information_schema.schemata
    WHERE schema_name IN ('raw','staging','warehouse','reporting','audit')")"
views="$($PSQL -tAc "SELECT count(*) FROM information_schema.views WHERE table_schema='reporting'")"
tables="$($PSQL -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='warehouse'")"
printf '  schemas=%s reporting views=%s warehouse tables=%s\n' "$schemas" "$views" "$tables"
[ "$schemas" = "5" ] || fail "expected 5 ARPI schemas, found $schemas."

# ---------------------------------------------------------------------------
# 8. The repository's own cloud verification
#
# Nine checks: server version, TLS, schemas, reporting view count, warehouse
# tables populated, exact reporting row counts, reconciliations recorded with none
# failing, the pipeline run's profile and seed, and reporter isolation. It never
# prints a host, port, user, database name or password — its output is safe as it
# stands.
#
# Run as the bootstrap/admin login, not as arpi_fabric: it counts warehouse rows
# and reads information_schema.table_privileges, and arpi_reporter is correctly
# not allowed to do either.
# ---------------------------------------------------------------------------
step 'Running scripts/verify_cloud_database.py'
ARPI_DATABASE__USER="$PGUSER" \
ARPI_DATABASE__PASSWORD="${PGPASSWORD}" \
ARPI_DATABASE__HOST="$PGHOST" \
ARPI_DATABASE__PORT="$PGPORT" \
ARPI_DATABASE__NAME="$PGDATABASE" \
ARPI_DATABASE__SSLMODE="$PGSSLMODE" \
    python scripts/verify_cloud_database.py \
    || fail 'cloud database verification reported a finding. Read the check name above.'

# ---------------------------------------------------------------------------
# 9. Prove the reporter boundary AS THE REAL LOGIN
#
# verify_cloud_database.py checks the boundary from the grant tables. This checks
# it by opening an actual connection as arpi_fabric and being refused, which is a
# stronger statement: SET ROLE from a privileged session can behave differently
# from a real login, and the credential about to be handed to Microsoft Fabric is
# this one.
#
# Each denial is REQUIRED. A query that succeeds here is a failure of the run.
# ---------------------------------------------------------------------------
step 'Proving the reporter boundary as arpi_fabric'
reporter_denied=0
for schema in raw staging warehouse audit; do
    # One probe, and its OUTPUT is what is judged rather than only its exit code.
    #
    # The distinction matters. Both of these fail the query:
    #   "permission denied for schema raw"    the boundary working — USAGE withheld
    #   "relation ... does not exist"         USAGE was GRANTED and the probe table
    #                                        simply is not there
    # Only the first is the control. Accepting any non-zero exit would let the
    # second pass as proof, and the second means the boundary has a hole in it:
    # without USAGE no grant on a table inside the schema can ever be exercised,
    # which is the whole mechanism.
    if message="$(PGUSER=arpi_fabric PGPASSWORD="${ARPI_FABRIC_PASSWORD}" \
        psql --quiet --no-psqlrc -tAc "SELECT 1 FROM ${schema}.__probe_does_not_matter" 2>&1)"
    then
        fail "arpi_fabric could query the ${schema} schema. The reporting boundary is not real."
    fi
    case "$message" in
        *"permission denied for schema"*)
            printf '  [ ok ] %s: permission denied for schema\n' "$schema"
            reporter_denied=$((reporter_denied + 1))
            ;;
        *)
            fail "arpi_fabric was refused on ${schema}, but not by schema permissions.
  PostgreSQL said: ${message}
  'relation does not exist' here means USAGE on ${schema} was granted, which the
  security model forbids: without USAGE, no grant on a table inside it can ever
  be exercised."
            ;;
    esac
done
unset message
[ "$reporter_denied" = "4" ] || fail "expected 4 schema denials, got $reporter_denied."

# The other half: it must be able to read what it is for.
readable="$(PGUSER=arpi_fabric PGPASSWORD="${ARPI_FABRIC_PASSWORD}" \
    psql --quiet --no-psqlrc -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='reporting'")"
printf '  [ ok ] reporting objects visible to arpi_fabric: %s\n' "$readable"
[ "$readable" -gt 0 ] || fail 'arpi_fabric can read nothing in reporting; INHERIT or the
  GRANT did not take effect, and a semantic model would connect and find an empty database.'

# ---------------------------------------------------------------------------
# 10. Record a NON-SECRET provisioning result
#
# Written to stdout, which is the Railway deploy log. It records what was built
# and the two non-secret coordinates the Fabric handoff needs. It records no host
# name for the private network, no user name's password, and no connection string.
# ---------------------------------------------------------------------------
step 'Provisioning result'
# `is_passing` is the view's own column name — a generated boolean over
# `status = 'passed'`. Named explicitly rather than guessed, because a typo here
# would silently report "unavailable" and hide a failing reconciliation.
recon="$($PSQL -tAc "SELECT count(*)::text || $$ recorded, $$ ||
    count(*) FILTER (WHERE NOT is_passing)::text || $$ failing$$
    FROM reporting.vw_reconciliation_status" 2>/dev/null || printf 'unavailable')"

printf '\n'
printf 'ARPI provisioning result\n'
printf '  profile              : %s\n' "$PROFILE"
printf '  schemas              : %s of 5\n' "$schemas"
printf '  reporting views      : %s\n' "$views"
printf '  warehouse tables     : %s\n' "$tables"
printf '  reconciliations      : %s\n' "$recon"
printf '  reporter boundary    : denied on raw, staging, warehouse, audit\n'
printf '  reporter can read    : %s reporting object(s)\n' "$readable"
printf '  TLS                  : %s\n' "$ssl_state"
printf '\n'
printf 'Microsoft Fabric handoff (non-secret coordinates)\n'
printf '  host                 : %s\n' "${ARPI_TCP_PROXY_DOMAIN:-unset}"
printf '  port                 : %s\n' "${ARPI_TCP_PROXY_PORT:-unset}"
printf '  database             : %s\n' "$PGDATABASE"
printf '  reporter username    : arpi_fabric\n'
printf '  TLS required         : yes (sslmode=require or stricter)\n'
printf '  password location    : Railway variable ARPI_FABRIC_PASSWORD on the\n'
printf '                         arpi-database-setup service. It is NOT printed here,\n'
printf '                         and must be copied from the Railway dashboard directly\n'
printf '                         into Fabric through a browser. See\n'
printf '                         deployment/railway/README.md section 8.\n'
printf '\n'
printf 'OK: provisioning complete. This job has finished and will not restart.\n'
