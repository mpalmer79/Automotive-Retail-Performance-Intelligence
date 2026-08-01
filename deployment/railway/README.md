# ARPI on Railway

How the ARPI website and its PostgreSQL database are deployed to **Railway**, what
is automated, what deliberately is not, and the one credential handoff that no
amount of automation can remove.

> **Production has not been approved and does not exist.** Everything below
> targets the `staging` environment. Every tool in this directory refuses to
> target `production`, in three independent places — the specification validator,
> the bootstrap tool, and the Infrastructure as Code declaration itself. Promoting
> to production is a separate, deliberate act described in
> [section 7](#7-production-is-not-approved).

---

## Contents

1. [What is deployed, and what is not](#1-what-is-deployed-and-what-is-not)
2. [One-time setup: the only manual steps](#2-one-time-setup-the-only-manual-steps)
3. [Running the bootstrap](#3-running-the-bootstrap)
4. [What the bootstrap does, and what Railway does](#4-what-the-bootstrap-does-and-what-railway-does)
5. [Variables: nothing is copied, nothing is typed](#5-variables-nothing-is-copied-nothing-is-typed)
6. [Provisioning the database](#6-provisioning-the-database)
7. [Production is not approved](#7-production-is-not-approved)
8. [The Microsoft Fabric handoff, and rotation](#8-the-microsoft-fabric-handoff-and-rotation)
9. [PR environments: evaluated, not enabled](#9-pr-environments-evaluated-not-enabled)
10. [Verifying, drift, and live-access tests](#10-verifying-drift-and-live-access-tests)
11. [What costs money](#11-what-costs-money)
12. [Rollback and teardown](#12-rollback-and-teardown)
13. [Files, and which one owns what](#13-files-and-which-one-owns-what)

---

## 1. What is deployed, and what is not

One Railway project, `ARPI`, with one environment, `staging`, containing three
services.

| Service               | What it is                                          | Public? | Database? |
| --------------------- | --------------------------------------------------- | ------- | --------- |
| `arpi-portfolio`      | the Next.js website, from this repository            | yes     | **no**    |
| `Postgres`            | Railway's official PostgreSQL, with a volume         | no      | is one    |
| `arpi-database-setup` | a one-time job that builds and loads the schema      | no      | yes       |

**There is no backend web service, and one must not be added.** The website is
fourteen statically prerendered routes with no runtime data source: it holds no
database credential, opens no connection, and is granted no reference to one. A
backend would be a service with nothing to serve.
`scripts/railway/verify_railway_configuration.ts` fails if a `DATABASE_*`, `PG*`
or password variable ever appears on the website, and warns if a service nobody
declared shows up in the project.

### Railway is the chosen host

Chosen over Vercel because ARPI needs a **cloud PostgreSQL database with an
externally reachable endpoint**, so that a cloud semantic-model engine — Microsoft
Fabric — can read the `reporting` schema. Fabric connects from Microsoft's
network and cannot reach a laptop or a private network. Railway provides the
website, the database, and the TCP proxy that makes the database reachable, in one
project with one credential and one bill.

Vercel support is **not removed**. `portfolio/vercel.json` still describes a
working Vercel deployment, and the site's canonical-origin resolver still honours
`VERCEL_ENV` and the deprecated `NEXT_PUBLIC_SITE_URL`. Keeping it costs one
config file and creates no security surface; removing it would be a separate
decision. See `portfolio/docs/DEPLOYMENT.md` section 3.

### The website requires no variable a human has to type

Zero. The canonical origin comes from Railway's own `RAILWAY_PUBLIC_DOMAIN`,
consumed as a Docker build argument and resolved by
`portfolio/src/lib/site-url.ts`. The case-study flag defaults to locked when
absent. See [section 5](#5-variables-nothing-is-copied-nothing-is-typed).

---

## 2. One-time setup: the only manual steps

Five things, once. Nothing after this requires a person until
[section 6](#6-provisioning-the-database) and
[section 8](#8-the-microsoft-fabric-handoff-and-rotation).

1. **Let the Railway GitHub App see this repository.** Railway → project →
   service → Settings → Source. Without this, Railway cannot read the repository
   and autodeploys never fire.

2. **Create one Railway API token.** Railway dashboard → Account Settings →
   Tokens. It must be **account- or workspace-scoped**, not project-scoped:
   creating a project, creating a service and generating a domain are
   account-level operations, and a project token cannot perform them.

3. **Store it as the GitHub Actions secret `RAILWAY_API_TOKEN`.** Repository →
   Settings → Secrets and variables → Actions. This is the **only** secret this
   repository needs. Do not add a database URL, a host, a port, a user name, a
   password or a domain — Railway provides or can reference every one of those
   itself, and a second copy is a second thing to rotate and a second place to
   leak from.

4. **Create the `railway-staging` GitHub environment** and add yourself as a
   required reviewer. Repository → Settings → Environments. The bootstrap
   workflow's credential-handling jobs are gated on it, so this is what turns
   "somebody clicked a button" into "somebody approved a change".

5. **Approve the paid resources.** The PostgreSQL service and its persistent
   volume cost money on Railway; there is no free tier that covers them. See
   [section 11](#11-what-costs-money) before the first apply.

### What you are never asked to do

- type the site's URL into a variable
- copy a value from one Railway service into another
- copy a database host, port, name or connection string anywhere
- put a database credential into GitHub
- enter a credential in a chat message or a command-line argument

---

## 3. Running the bootstrap

### From GitHub Actions (the intended path)

Actions → **Railway bootstrap** → Run workflow.

| Input         | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `mode`        | `dry-run` reports the plan and changes nothing. `apply` converges it. |
| `verify_only` | Skip bootstrap; only verify the live configuration.                   |

Run `dry-run` first, read the plan in the job summary, then run `apply`.

### Locally

```bash
export RAILWAY_API_TOKEN=...        # never as a flag; the tools refuse that

npm ci                              # from the repository root
npm run spec:validate               # offline; no credential
npm run iac:evaluate                # offline; no credential
npm run bootstrap:dry-run           # needs the token; mutates nothing
npm run bootstrap                   # converges the project
npm run verify:railway              # reads the live configuration back
```

`--json` on any of them emits a machine-readable, redacted document on stdout with
progress on stderr, so `npm run verify:railway -- --json | jq` works.

### Re-running is safe, and that is asserted rather than asserted

The bootstrap is idempotent. Running it again creates no second project, no second
service, no second domain, no second volume; it does not replace the database, does
not regenerate a password, and does not trigger a deployment when the latest one
already succeeded. On a converged project it reports `no changes pending`.

That is not a claim in a document. `tests/railway/bootstrap.test.ts` runs the real
tool against a fake Railway CLI that records every invocation, and asserts that a
converged run issues no mutating command at all.

---

## 4. What the bootstrap does, and what Railway does

Most of the convergence is **not** the bootstrap tool's. `railway config apply`
reads `.railway/railway.ts` and converges the project onto it, and Railway's own
apply path is what makes that idempotent: it creates a service only when no
service of that name exists, and creates a database's volume only when that
database has none.

The tool does the four things a declaration structurally cannot express, plus the
reporting:

| Step                            | Why it is not declarative                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| find or create the **project**  | a declaration cannot create the project it is a declaration of                                                                 |
| find or create the **environment** | and refuse to touch `production`                                                                                            |
| generate the **public domain**  | a Railway-generated domain's name is chosen by Railway and is not knowable in advance, so it cannot be written down            |
| trigger and **poll** the deploy | `railway up`/`redeploy` returns before the deployment is healthy; the CLI's own notes say to poll `deployment list`             |

**The domain is generated before the first deployment, deliberately.** The build
reads `RAILWAY_PUBLIC_DOMAIN` to produce canonical URLs, the sitemap and the Open
Graph tags. Generate it afterwards and the first build bakes in
`http://localhost:3000` — a site that works and points search engines at a machine
that does not exist.

### Routine deployments have exactly one owner

After bootstrap, **Railway's GitHub integration deploys `main`**, waiting for this
repository's CI checks first (`checkSuites`). GitHub Actions is used for bootstrap,
verification and post-deployment checks — never for a routine `railway up`. Two
deployment owners would make it impossible to say which system deployed what.

### Watch paths are not `portfolio/**`

The website displays no authored number: every count and status is generated at
build time from evidence spread across the repository. A change to a Power BI
validation result, the KPI catalogue, a gate readiness document or the SQL tree
changes what the site is *required* to say while touching nothing under
`portfolio/`. Watching only `portfolio/**` would leave the deployed site asserting
a status the repository had already stopped evidencing.

`railway.json` therefore watches all of it, and
`portfolio/tests/unit/railway-config.test.ts` extracts the manifest generator's own
read set and fails if any source it touches is not covered — by the watch
patterns, by the Dockerfile's `COPY` list, or by `.dockerignore`.

---

## 5. Variables: nothing is copied, nothing is typed

### The website: two automatic literals, no user input, no credential

| Variable                              | Value     | Set by  |
| ------------------------------------- | --------- | ------- |
| `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` | `false`   | the IaC |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30`      | the IaC |

Neither is typed by a person. The case-study flag is stated explicitly rather than
left to absence so that an operator reading the Railway dashboard sees the gate
closed instead of inferring it; it is one of five conditions and **cannot unlock
anything on its own**.

The canonical origin is **not** a variable. `portfolio/src/lib/site-url.ts`
resolves it, in order:

1. `ARPI_SITE_URL` — an explicit server-only override, needed only for a custom
   domain
2. `https://${RAILWAY_PUBLIC_DOMAIN}` — the platform's own answer, and the one
   that is used
3. `NEXT_PUBLIC_SITE_URL` — **deprecated**, ordered below the platform on purpose
   so a value left over from Vercel cannot override where the deployment actually is
4. a request origin, for a host on a strict allow-list
5. `http://localhost:3000`

`RAILWAY_PUBLIC_DOMAIN` reaches the build through an `ARG` of the same name in
`portfolio/Dockerfile.railway`. A Railway service variable is invisible to a
Dockerfile build unless an `ARG` declares it — that is the mechanism, not a
detail.

### The provisioning job: eight references, two generated secrets, no copies

| Variable                                       | Kind      | Expression                              |
| ---------------------------------------------- | --------- | --------------------------------------- |
| `DATABASE_URL`                                 | reference | `${{Postgres.DATABASE_URL}}`            |
| `PGHOST`                                       | reference | `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}`  |
| `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD`    | reference | `${{Postgres.<name>}}`                  |
| `ARPI_TCP_PROXY_DOMAIN` `ARPI_TCP_PROXY_PORT`  | reference | `${{Postgres.RAILWAY_TCP_PROXY_*}}`     |
| `ARPI_PIPELINE_PASSWORD` `ARPI_FABRIC_PASSWORD`| generated | `secret(48, "<alphanumeric>")`          |
| `ARPI_PROFILE` and four more                   | literal   | non-secret configuration                |

A **reference** is resolved by Railway at deploy time. Nothing is copied, so
nothing goes stale, and this repository never contains a database credential.

A **generator** is evaluated **server-side by Railway** — the same mechanism
Railway's own Postgres template uses for `POSTGRES_PASSWORD`. The consequence is
the point: the value never exists in this repository, never appears in a process
argument, never reaches a log, and is not known to the bootstrap tool or to GitHub
Actions.

In the declaration these are written through typed accessors (`db.env.PGPASSWORD`,
`ref(db, 'RAILWAY_TCP_PROXY_PORT')`) rather than as strings, so a misspelled
variable name is a compile error. A hand-written `${{Postgres.DATABSE_URL}}` would
deploy successfully and resolve to that literal text.

### Config as Code does not manage secrets, and cannot

`railway.json` owns build and deploy configuration: the Dockerfile path, the watch
patterns, the health check, the restart policy. It **cannot** create a service,
create a database, create a domain or set a variable — Config as Code has no
vocabulary for any of those, which is exactly why `.railway/railway.ts` exists.
And it is committed to a public repository, so it must never contain a secret;
`portfolio/tests/unit/railway-config.test.ts` asserts it has no `variables` block
and no credential-shaped value.

### One live owner, deliberately

`.railway/railway.ts` **imports** `railway.json` rather than restating it, so the
two cannot disagree about the build. No service sets `configFile`, and that is not
an omission: Railway's IaC refuses to manage a service whose `configFile` names a
`railway.json` or `railway.toml`, so such a service would converge once and then
never again — destroying the idempotency this design rests on. If a `config plan`
ever reports `already managed by railway.json`, the bootstrap tool says so and
names the remedy: clear the "Config as code" path on that service in the
dashboard.

### Shared variables: none

A shared variable is the right tool when three or more services need the same
value. Here exactly one service consumes the database, so a direct service
reference is both narrower and clearer about who depends on what.

---

## 6. Provisioning the database

The bootstrap creates the database. It does **not** build the schema or load the
data — that is one deliberate run of the `arpi-database-setup` service.

### Why a job inside Railway, and not a CI step

Evaluated three ways:

| Model                                    | Verdict                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| a one-time job service inside Railway    | **chosen.** Reaches PostgreSQL over the project's **private** network using reference variables. No credential leaves Railway or passes through GitHub, and the public TCP proxy is not needed to build the database |
| a GitHub Actions step over the TCP proxy | rejected. The workflow would hold a live superuser connection URL, and the database would need public exposure merely to be built              |
| `railway run` from a laptop              | rejected as the primary path — it is not reproducible and depends on whose machine it was — but it remains the fallback if the job cannot run  |

### Running it

```bash
railway link --project ARPI --environment staging
railway redeploy --service arpi-database-setup --yes
railway logs --service arpi-database-setup
```

Or redeploy the service once from the Railway dashboard. Its restart policy is
**`NEVER`**, so a completed run is not restarted into a loop — which is how a
one-time job quietly becomes a permanent service.

### What it does, in order

1. asserts every required reference and generated variable is present (presence
   only; no value is printed)
2. waits for PostgreSQL to accept connections
3. **proves the session is encrypted** by reading `pg_stat_ssl` — `sslmode=require`
   is a request, not evidence — before creating any credential over it
4. confirms the connecting role holds `CREATEROLE`, without which the three-role
   separation cannot exist
5. runs the repository's ordered SQL sequence, the same one `sql/README.md`
   section 2 defines, including the second `01_grants.sql` pass that is
   load-bearing on a managed provider
6. creates the login roles `arpi_pipeline` (holding `arpi_loader`) and
   `arpi_fabric` (holding `arpi_reporter`), with the Railway-generated passwords,
   passed to `psql` on stdin and never as arguments
7. loads the `development` profile **as `arpi_pipeline`** — the three-role
   separation is only real if it is used
8. verifies structure: five schemas, the reporting views, the warehouse tables
9. runs `scripts/verify_cloud_database.py` — nine checks, and it prints no host,
   port, user, database name or password even in its error output
10. **proves the reporter boundary as the real login**, opening an actual
    connection as `arpi_fabric` and requiring `permission denied for schema` on
    `raw`, `staging`, `warehouse` and `audit`. A `relation does not exist` is
    treated as a FAILURE, because it would mean `USAGE` was granted
11. records a non-secret provisioning result, including the Fabric handoff
    coordinates

### Safe to rerun

Every step is idempotent. The SQL sequence prints `already exists, skipping`; the
login roles are created only when absent; the loader's Type 1 upserts fire only
where an attribute differs and its Type 2 merges only where an `attribute_hash`
changes, so a second run writes zero warehouse rows. Nothing drops, truncates or
recreates anything.

`sql/99_local_reset.sql` is present in the image and is **never invoked**. It DROPs
every ARPI schema, and refuses to run unless the database name begins `arpi_` —
Railway's database is called `railway`, so the guard already rejects it. Leave it
that way.

### It does not run on a website deployment

A commit that changes the website does not re-run a data load. The job's watch
patterns cover `sql/`, `src/arpi/`, `config/` and its own Dockerfile, and nothing
else.

---

## 7. Production is not approved

No production deployment of this site exists, and this tooling will not create
one. Three independent guards:

1. `scripts/railway/lib/spec.ts` fails if the specification's target environment
   is the production environment, or if `createProductionEnvironment` is true
2. `scripts/railway/bootstrap_railway.ts` reads `railway status` after linking and
   refuses to proceed if the linked environment resolves to `production`
3. `.railway/railway.ts` **throws** rather than emitting a graph when evaluated
   against production, so `railway config apply` fails before it can stage
   anything — and `tests/railway/iac-graph.test.ts` asserts that guard actually
   fires

The declaration also names only `staging` in its `environments` list, because
declaring an environment creates it.

### Promoting to production, when it is approved

A deliberate, separate change: add `production` to the specification and the
declaration, decide whether it gets a custom domain, set `ARPI_SITE_URL` if so,
and re-run bootstrap against it. The site's `IS_PREVIEW` rule means every Railway
environment **other than** `production` is `noindex` with crawling disallowed, so
promotion is also the moment the site becomes indexable. That is a decision, not a
side effect.

---

## 8. The Microsoft Fabric handoff, and rotation

**This is the one manual credential step, and it cannot be automated away.**
Configuring a data source inside Microsoft Fabric requires Fabric authentication
and permissions that Railway does not have and this repository must not hold.

### What the handoff consists of

Everything except the password is non-secret and is reported by the tooling:

| Field             | Where it comes from                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| host              | `railway variables` → `RAILWAY_TCP_PROXY_DOMAIN`, or the bootstrap output  |
| port              | `RAILWAY_TCP_PROXY_PORT`, or the bootstrap output                         |
| database          | `PGDATABASE` (Railway's default is `railway`)                             |
| reporter username | `arpi_fabric` — a LOGIN role holding `arpi_reporter` and nothing else      |
| TLS               | **required.** `sslmode=require` or stricter                               |
| password          | the Railway variable `ARPI_FABRIC_PASSWORD` on `arpi-database-setup`       |

`scripts/railway/bootstrap_railway.ts --json` reports the host and port as
outputs, and `deployment/railway/provision_database.sh` prints the whole non-secret
set at the end of a provisioning run. **Neither prints the password.**

### The password never leaves Railway except through a browser

The reporter password appears in exactly one place: Railway's variable store. It
is generated there, by Railway, and it is deliberately absent from:

- GitHub Actions output and workflow summaries
- pull-request comments
- any file in this repository
- deployment logs
- the tools' `--json` artefacts
- chat messages

To configure Fabric: open the Railway dashboard in a browser, reveal
`ARPI_FABRIC_PASSWORD` on the `arpi-database-setup` service, and paste it directly
into Fabric's credential store. Do not route it through a terminal, a file, a
ticket or a message.

Then update `docs/powerbi/FABRIC_SERVICE_HANDOFF.md` with what was configured —
**not with the password**.

### After Fabric is connected: sealing the variable

Railway supports marking a variable **sealed**, after which its value can no longer
be read back through the dashboard or the API — only overwritten. That is the right
end state for `ARPI_FABRIC_PASSWORD` once Fabric holds its own copy, and it is
deliberately **not** done by the bootstrap: sealing before the value has been read
would make it unrecoverable, and the whole point is that a human reads it exactly
once.

The IaC's `VariableConfig` carries an `isSealed` field, so sealing can be declared
once the handoff is complete. Until then it stays readable.

### Rotating the reporter password safely

`ARPI_FABRIC_PASSWORD` is **not** rotated on every deployment, and that is
deliberate: rotating it on an unrelated commit would silently break a configured
Fabric connection, and a credential that breaks downstream on every deploy gets
replaced with a permanent one by whoever is on call.
`scripts/railway/lib/spec.ts` fails if the specification ever marks it
`rotateOnEveryDeploy`.

To rotate it on purpose:

1. change the value in Railway (delete it and let the generator produce a new one,
   or set a new value)
2. redeploy `arpi-database-setup` once — it runs `ALTER ROLE arpi_fabric PASSWORD`
   from the Railway value, so the database converges onto whatever Railway holds
3. update Fabric's stored credential from the browser
4. confirm a Fabric refresh still succeeds

Steps 2 and 3 are a window during which Fabric has the old password and the
database has the new one. Do them together.

---

## 9. PR environments: evaluated, not enabled

Railway can create an environment per pull request. It is **not** enabled here, and
the reasoning is recorded rather than left implicit:

- **Cost.** `railway environment new --duplicate` copies the environment's
  services, which would clone the PostgreSQL service **and its persistent volume**
  per pull request. Two open PRs would triple the database bill for data that is
  synthetic, reproducible from a seed, and identical in every copy.
- **No benefit for the website.** The site has no runtime database connection, so a
  preview would exercise nothing the local production build and the `railway-image`
  CI job do not already exercise — and both of those run on every push, for free.
- **Sealed and generated variables.** A duplicated environment's handling of a
  sealed variable and of a server-side generator is exactly the kind of behaviour
  that must be verified against a live account before being relied on, and no live
  account existed when this was written.
- **Token scope with 2FA.** Environment creation is an account-level operation, and
  its reliability under an account with 2FA enabled is not something this
  repository can assert.

If PR environments are wanted later, the shape that would work is a
**portfolio-only** environment that references the shared `staging` database rather
than duplicating it — the website needs no database at all, so it needs no copy of
one — created by a `.github/workflows/railway-pr-environments.yml` that skips
documentation-only changes and deletes the environment when the PR closes. That
file is deliberately absent rather than present and disabled.

---

## 10. Verifying, drift, and live-access tests

### Offline, on every push, with no credential

| Command                 | What it proves                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run spec:validate` | the specification is internally consistent, agrees with `railway.json`, targets non-production, holds no credential |
| `npm run iac:evaluate`  | the declaration compiles into the graph the specification describes: references where required, generators where required, no literal credential |
| `npm test`              | redaction, spec guards, graph assertions, tolerant CLI parsing, and the bootstrap tool's behaviour against a fake Railway CLI |

These run in `ci.yml`'s `deployment-tooling` job. They need no secret, so they run
on a fork.

### Against the live project

```bash
npm run verify:railway              # needs RAILWAY_API_TOKEN
```

Checks the project, the environment, the services, the GitHub source and branch,
the public domain, the volume, the TCP proxy, and — the one that matters most —
that the job's cross-service variables are **still unresolved `${{...}}`
expressions**.

That last check exists because the failure it catches is silent. A reference that
has been replaced by its resolved value still *works*: the job connects, the
deployment succeeds, and the project now holds a copy of a database password that
will not follow a rotation. Nothing announces it.

### Drift

`railway config plan --detailed-exit-code` exits `2` when the live project differs
from the declaration. Because the declaration reads `railway.json`, that single
assertion covers the Dockerfile path, the watch patterns, the health check, the
restart policy, the replica count, the build context, the wait-for-CI setting and
every declared variable at once. `verify:railway` reports it as a failure and names
the remedy.

**Drift is expected, not exceptional.** Somebody changes a health-check path in the
dashboard; a watch pattern is edited and nobody re-runs bootstrap. Re-running the
bootstrap workflow converges it.

### Reading variable values

Don't. `railway variable list --json` and `--kv` print **raw values** — the CLI's
own documentation says so. The verifier reads keys, and the *text* of a value only
to decide whether it is still a `${{...}}` expression. Everything these tools print
passes through `scripts/railway/lib/redact.ts` regardless.

### Live-access tests

There are no live Railway integration tests in the default suite, on purpose: a
test that needs an account credential cannot run on a fork, and a suite that is
skipped in most runs is a suite nobody trusts. The live checks are the two commands
above, run explicitly.

---

## 11. What costs money

Railway has no free tier that covers this. Before the first `apply`:

| Resource                        | Cost                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `arpi-portfolio`                | compute for one small always-on container. `sleepApplication` is off, so it does not scale to zero |
| `Postgres`                      | compute for an always-on database                                     |
| the PostgreSQL **volume**       | storage, billed by size. The `development` profile fits in a few hundred megabytes including indexes and audit history |
| `arpi-database-setup`           | compute only while it runs, then nothing — its restart policy is `NEVER` |
| the **TCP proxy**               | no charge for the proxy itself, but see egress below                  |
| **egress**                      | see below                                                             |

### TCP proxy egress

The TCP proxy is how Microsoft Fabric reaches the database, and every byte a
Fabric refresh reads leaves Railway as **egress**. A full refresh of the
`development` profile reads the reporting views — roughly 55,000 fact rows — so a
single refresh is small. A **scheduled** refresh every hour is 24 of those a day,
indefinitely, for data that is deterministic and does not change unless somebody
re-runs the loader.

Configure Fabric to refresh **on demand**, not on a schedule. The dataset is
synthetic and reproducible; there is nothing for a schedule to keep up with.

### Keeping the bill honest

- confirm in Railway's usage page which resources are actually running
- the `arpi-database-setup` service should show no running deployment once
  provisioning has completed; if it does, its restart policy has been changed
- `verify:railway` warns about any service the specification does not declare,
  which is the usual way an unnoticed cost appears

---

## 12. Rollback and teardown

### Rolling back the website

Railway keeps previous deployments addressable, so rollback is redeploying the
previous one — a dashboard action, or:

```bash
railway deployment list --service arpi-portfolio --json
railway redeploy --service arpi-portfolio --yes
```

No rebuild, no revert commit.

For a **content** problem rather than a code problem the faster fix is usually
upstream: every number and status on the site comes from the generated manifest, so
correcting an evidence file and letting Railway rebuild changes what the site says.
There is no cache to purge.

If a deployment ever publishes a claim it should not have, the order is: **roll
back first, then fix the evidence, then redeploy.** The wrong claim being public is
the urgent part.

### Rolling back a configuration change

`railway config apply` converges onto the declaration, so reverting the commit and
re-running the bootstrap workflow reverts the configuration. Destructive changes
are not applied unattended: the tool never passes `--confirm-destructive`, so a
plan that wants to delete something stops and waits for a person.

### Tearing down staging

The website and the job can be deleted freely. **The database cannot be
un-deleted**, and deleting its volume destroys the data — which is survivable here
and only here, because the data is synthetic and reproducible from this repository
by re-running the provisioning job.

```bash
railway service delete --service arpi-portfolio --environment staging --yes
railway service delete --service arpi-database-setup --environment staging --yes
# The database and its volume are the paid, stateful part. Delete deliberately.
railway service delete --service Postgres --environment staging --yes
railway volume list --json      # confirm no orphaned volume is still billing
```

If Fabric was connected, its data source will start failing. Remove it there too.

---

## 13. Files, and which one owns what

| File                                          | Owns                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `deployment/railway/project.config.json`      | project, environment, service names, networking, build context, expected platform variables |
| `deployment/railway/variables.config.json`    | every variable key, its kind, and its reference expression            |
| `deployment/railway/tooling.json`             | pinned Railway CLI, SDK and Lighthouse versions, and the CLI commands that were verified against `--help` |
| `deployment/railway/Dockerfile.database-setup`| the provisioning job's image                                          |
| `deployment/railway/provision_database.sh`    | the provisioning sequence                                             |
| `railway.json` (repository root)              | build and deploy configuration: Dockerfile path, watch patterns, health check, restart policy |
| `.railway/railway.ts`                         | the live project: services, database, variables, references, generators. Imports `railway.json` |
| `portfolio/Dockerfile.railway`                | the website's image, built from the repository root                    |
| `.dockerignore`                               | what never reaches a builder                                          |
| `scripts/railway/bootstrap_railway.ts`        | project, environment, domain, deployment, reporting                   |
| `scripts/railway/verify_railway_configuration.ts` | live configuration and drift                                      |
| `scripts/railway/audit_deployed_site.ts`      | the Lighthouse audit of the deployed site                             |
| `.github/workflows/railway-bootstrap.yml`     | the manual bootstrap, and the only workflow holding a secret           |

### None of these may contain a credential

Not the specification, not `railway.json`, not the declaration, not the workflow.
`scripts/check_secrets.py` runs over the whole tree in both CI workflows, and
`scripts/railway/lib/spec.ts` additionally fails if a credential-shaped value
appears anywhere in the specification — because a value that *looks* like a
credential in a public repository is a defect whether or not it is real.

---

## See also

- [`portfolio/docs/DEPLOYMENT.md`](../../portfolio/docs/DEPLOYMENT.md) — the
  website's own deployment contract, its variables and its headers
- [`docs/cloud-database-setup.md`](../../docs/cloud-database-setup.md) — the manual
  cloud database procedure this automates
- [`docs/powerbi/FABRIC_SERVICE_HANDOFF.md`](../../docs/powerbi/FABRIC_SERVICE_HANDOFF.md)
  — what Fabric needs, and what it proves
- [`SECURITY.md`](../../SECURITY.md) — the repository's credential rules
- [`LIMITATIONS.md`](../../LIMITATIONS.md) — what this deployment does not do
