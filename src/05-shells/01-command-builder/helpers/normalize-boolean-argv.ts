/**
 * Boolean-flag argv normalization.
 *
 * oclif boolean flags do not accept an explicit value: `--flag true` fails
 * with "Unexpected argument: true", and the only way to force false is the
 * auto-generated `--no-flag`. But users reasonably type `--generate-audio
 * false` (or `=false`, or the short `-v false`) and get a cryptic error that
 * makes the flag look dead — exactly the seedance `--generate-audio false`
 * footgun.
 *
 * These helpers rewrite the value forms into what oclif accepts, applied to
 * `this.argv` BEFORE `parse()`:
 *
 *   --flag true    → --flag
 *   --flag false   → --no-flag
 *   --flag=true    → --flag
 *   --flag=false   → --no-flag
 *   -c true/false  → --flag / --no-flag   (char mapped to its long name)
 *
 * Only tokens whose flag is known-boolean are touched — a string flag that
 * legitimately takes the literal value "true"/"false" (e.g. `--prompt false`)
 * is passed through untouched. The value match is case-insensitive.
 */

interface OclifFlagLike {
  type?: string;
  char?: string;
  aliases?: string[];
}

/**
 * Build a lookup from every accepted invocation form of each BOOLEAN flag
 * (its name, its aliases, and its single-char short) to the flag's canonical
 * long name. Non-boolean flags are skipped entirely, so their forms never
 * appear and are never rewritten.
 */
export function booleanFlagForms(flags: Record<string, unknown>): Map<string, string> {
  const forms = new Map<string, string>();
  for (const [name, raw] of Object.entries(flags)) {
    const def = raw as OclifFlagLike | undefined;
    if (def?.type !== 'boolean') continue;
    forms.set(name, name);
    for (const alias of def.aliases ?? []) forms.set(alias, name);
    if (def.char) forms.set(def.char, name);
  }
  return forms;
}

function stripDashes(token: string): string {
  return token.replace(/^--?/, '');
}

function valueBool(value: string): boolean | undefined {
  const v = value.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

/**
 * Rewrite explicit-value boolean forms in `argv` into oclif-native forms.
 * `booleanForms` comes from {@link booleanFlagForms}. Everything after a bare
 * `--` terminator is preserved verbatim (oclif treats it as positional args).
 */
export function normalizeBooleanFlagArgv(argv: string[], booleanForms: Map<string, string>): string[] {
  const out: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    // Everything past `--` is args, not flags — leave it exactly as-is.
    if (token === '--') {
      out.push(...argv.slice(i));
      break;
    }

    if (token.startsWith('-') && token !== '-') {
      // `--flag=value` form.
      const eq = token.indexOf('=');
      if (eq !== -1) {
        const canon = booleanForms.get(stripDashes(token.slice(0, eq)));
        const bool = canon !== undefined ? valueBool(token.slice(eq + 1)) : undefined;
        if (canon !== undefined && bool !== undefined) {
          out.push(bool ? `--${canon}` : `--no-${canon}`);
          continue;
        }
        out.push(token);
        continue;
      }

      // `--flag value` / `-c value` form — only consume the next token when
      // this flag is boolean AND that token is literally true/false.
      const canon = booleanForms.get(stripDashes(token));
      if (canon !== undefined) {
        const next = argv[i + 1];
        const bool = next !== undefined ? valueBool(next) : undefined;
        if (bool !== undefined) {
          out.push(bool ? `--${canon}` : `--no-${canon}`);
          i += 1;
          continue;
        }
      }
      out.push(token);
      continue;
    }

    out.push(token);
  }

  return out;
}
