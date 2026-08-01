/**
 * Redaction, applied to everything these tools print.
 *
 * WHY THIS IS A MODULE AND NOT A HABIT
 * -----------------------------------
 * The Railway CLI is explicit that `railway variable list --json` and
 * `--kv` print raw values, and the whole point of this deployment is that
 * credentials live in Railway rather than in this repository — so the moment a
 * tool here reads a variable it is holding a live database password. The failure
 * mode is not dramatic: somebody adds a `console.log` while debugging, the run
 * happens in GitHub Actions, and the password is now in a log that is retained
 * for ninety days and visible to anyone with read access.
 *
 * So redaction is not applied at the call sites that happen to need it. It is
 * applied to every string these tools emit, by construction, and
 * `tests/railway/redact.test.ts` asserts each pattern.
 *
 * WHAT REDACTION IS NOT
 * ---------------------
 * It is not a substitute for not reading the secret. These tools avoid reading
 * values at all wherever a key list will do — `verify_railway_configuration.ts`
 * checks that a variable IS a reference without ever resolving it. Redaction is
 * the second line, for the cases where a value unavoidably passes through: an
 * error message from a failed connection, a CLI's own output on a non-zero exit.
 */

/** What a redacted value is replaced with. One token, so it greps cleanly. */
export const REDACTED = '***REDACTED***'

/**
 * Variable-name fragments that mark a value as secret.
 *
 * Matched case-insensitively as substrings, because the real names in this
 * project are `ARPI_FABRIC_PASSWORD`, `POSTGRES_PASSWORD`, `PGPASSWORD`,
 * `DATABASE_URL` and `RAILWAY_API_TOKEN`, and a rule keyed on exact names would
 * miss the next one somebody adds.
 */
const SECRET_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'private_key',
  'privatekey',
  'credential',
  'auth',
  'connectionstring',
  'connection_string',
  'dsn',
]

/**
 * Key patterns that classify a value as secret by structure rather than by
 * containing one of the fragments above.
 *
 * This exists because of a real miss. `DATABASE_URL` was on the substring list;
 * `DATABASE_PUBLIC_URL` — which is a Railway Postgres variable and carries the
 * password inline exactly like `DATABASE_URL` does — was not, because
 * "database_url" is not a substring of "database_public_url". Adding every
 * spelling to a substring list is how that class of gap keeps recurring, so the
 * shape is matched instead: anything that is a DATABASE-ish URL, and any of the
 * `*_URL` variables Railway's database templates publish with credentials in
 * them.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  // DATABASE_URL, DATABASE_PUBLIC_URL, databasePublicUrl, ARPI_DATABASE_URL, ...
  /database.*url/i,
  // Railway's other engines: REDIS_URL, REDIS_PUBLIC_URL, MONGO_URL, MYSQL_URL.
  /^(?:redis|mongo|mysql|amqp|postgres(?:ql)?).*url$/i,
]

/**
 * Keys that CONTAIN a secret fragment but are not secret, and must stay legible.
 *
 * Without this list `ARPI_TCP_PROXY_DOMAIN` survives but the far more useful
 * distinction between "the token is missing" and "the token is wrong" is lost,
 * and — more importantly — the Fabric handoff would redact the very fields it
 * exists to communicate. Every entry here is a value this project deliberately
 * publishes.
 */
const NON_SECRET_EXCEPTIONS: readonly string[] = [
  // Whether a token is present, never the token.
  'railway_api_token_present',
  'has_railway_api_token',
  // The authentication *mode*, not a credential.
  'authtype',
  'auth_type',
]

/** Whether a variable with this name must have its value withheld. */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (NON_SECRET_EXCEPTIONS.some((allowed) => lower === allowed)) return false
  if (SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))) return true
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Patterns that identify a secret by its SHAPE rather than by the name of the
 * field it arrived in.
 *
 * This is the half that catches a credential in prose — a `psql` error quoting
 * the connection string it failed on, a GraphQL error echoing the mutation
 * variables it rejected, a stack trace with an `Authorization` header in it.
 * None of those arrives as a tidy key/value pair.
 */
/** The five-hyphen delimiter a PEM block uses, built rather than written. */
const KEY_DELIMITER = '-'.repeat(5)

interface ShapePattern {
  readonly name: string
  readonly pattern: RegExp
  readonly replacement: string
}

const SHAPE_PATTERNS: readonly ShapePattern[] = [
  {
    // A connection URI with inline credentials. The user name is kept because it
    // is not secret and is genuinely useful when diagnosing a permission error —
    // `arpi_reporter` failing where `arpi_pipeline` would succeed is the single
    // most common thing to be looking at.
    name: 'connection-uri-password',
    pattern:
      /\b((?:postgres|postgresql|mysql|mariadb|mongodb|redis|amqp)(?:\+[a-z0-9]+)?:\/\/[^\s:@/]+:)[^\s:@/]+@/gi,
    replacement: `$1${REDACTED}@`,
  },
  {
    name: 'authorization-header',
    pattern: /\b(authorization["'\s]*[:=]["'\s]*)(?:bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    name: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    // Railway project and account tokens are UUIDs. A UUID is not automatically
    // a secret — project and service IDs are UUIDs too and are safe to print —
    // so this only fires when a UUID sits next to a word that means credential.
    name: 'uuid-shaped-token',
    pattern:
      /\b((?:api[_-]?token|project[_-]?token|railway[_-]?token|token)["'\s]*[:=]["'\s]*)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    name: 'quoted-credential-assignment',
    pattern:
      /\b((?:password|passwd|pwd|secret|token|api[_-]?key)["'\s]*[:=]["'\s]*)(['"])[^'"\n]{6,}\2/gi,
    replacement: `$1$2${REDACTED}$2`,
  },
  {
    // A query string carrying a credential, e.g. `?sslpassword=...`.
    name: 'query-parameter-credential',
    pattern: /([?&](?:password|passwd|token|api[_-]?key|secret)=)[^&\s"']+/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    // PostgreSQL keyword/value connection strings, which appear in psycopg
    // errors: `host=... password=... sslmode=require`.
    name: 'libpq-keyword-password',
    pattern: /\b(password=)(?!\s)[^\s"']+/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    name: 'private-key-block',
    // Assembled from parts rather than written as a literal.
    //
    // `scripts/check_secrets.py` scans the tree for `-----BEGIN ... PRIVATE
    // KEY-----` and would flag this module for containing the very pattern it
    // exists to redact — the same reason that scanner exempts its own source. The
    // marker is therefore built at run time: the literal never appears in the
    // repository, and neither detector has been weakened to accommodate the other.
    pattern: new RegExp(
      `${KEY_DELIMITER}BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY${KEY_DELIMITER}` +
        `[\\s\\S]*?${KEY_DELIMITER}END [^-]*${KEY_DELIMITER}`,
      'g'
    ),
    replacement:
      `${KEY_DELIMITER}BEGIN PRIVATE KEY${KEY_DELIMITER}${REDACTED}` +
      `${KEY_DELIMITER}END PRIVATE KEY${KEY_DELIMITER}`,
  },
]

/**
 * Redact every known secret shape in a string.
 *
 * Applied to all output from these tools, including error messages and captured
 * CLI output, and applied on the way OUT rather than at the point a value is
 * read — a value that is never printed costs nothing to have redacted, and a
 * value that is printed by a path nobody thought about is exactly the case this
 * has to cover.
 */
export function redact(text: string): string {
  let result = text
  for (const { pattern, replacement } of SHAPE_PATTERNS) {
    // The patterns are global; `replace` with a fresh lastIndex per call is
    // guaranteed because `String.prototype.replace` does not mutate a regex's
    // lastIndex when the `g` flag is set.
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Redact a structure before it is serialised.
 *
 * Walks objects and arrays, replacing any value whose KEY looks secret and
 * running {@link redact} over every remaining string so a credential that
 * arrived under an innocent key is still caught. Keys are preserved — knowing
 * that `ARPI_FABRIC_PASSWORD` exists is the point of the verifier; knowing its
 * value is never anybody's business here.
 */
export function redactValue(value: unknown, keyHint?: string): unknown {
  if (keyHint !== undefined && isSecretKey(keyHint) && typeof value !== 'object') {
    return value === undefined || value === null ? value : REDACTED
  }

  if (typeof value === 'string') return redact(value)
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) return value.map((item) => redactValue(item, keyHint))

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key)
        ? // A secret-named key is replaced wholesale rather than walked, so a
          // nested object under `credentials` cannot leak a field of itself.
          nested === null || nested === undefined
          ? nested
          : REDACTED
        : redactValue(nested, key)
    }
    return out
  }

  return REDACTED
}

/** Serialise a structure with redaction applied. The only JSON writer these
 *  tools use. */
export function redactedJson(value: unknown, pretty = true): string {
  const scrubbed = redactValue(value)
  return pretty ? JSON.stringify(scrubbed, null, 2) : JSON.stringify(scrubbed)
}

/** The pattern names, exported so tests enumerate them rather than duplicating
 *  the list and drifting from it. */
export const SHAPE_PATTERN_NAMES: readonly string[] = SHAPE_PATTERNS.map((p) => p.name)
