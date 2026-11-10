/**
 * FORK-ONLY. What an identity provider's group names go through before the wiki matches them against
 * its own groups: the ignore list, then the mappings. Both are written by an administrator on the
 * strategy as one entry per line, and parsed here both when the strategy is saved (to refuse a line
 * that cannot work) and at every login (to apply them).
 *
 * In this order, so that a mapping never has to be written for a group that is ignored anyway, and an
 * ignore pattern is always about what the PROVIDER calls a group — the names an administrator sees in
 * the provider's own console — rather than what the wiki calls it.
 */

/** One line of a strategy's group mappings: a provider group, and the wiki group it stands for. */
export interface GroupMapping {
  from: string
  to: string
}

/** The separator between the two sides of a mapping line. */
const MAPPING_ARROW = '->'

/** Lines that say something: blank ones and `#` comments are for the administrator alone. */
function entryLines(text: string | undefined | null): { line: string; number: number }[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line, idx) => ({ line: line.trim(), number: idx + 1 }))
    .filter(({ line }) => line.length > 0 && !line.startsWith('#'))
}

/**
 * The ignore list: one regular expression per line, matched against each provider group name, ignoring
 * case and anywhere in the name unless anchored — `^authentik ` for the provider's own groups.
 *
 * @returns The patterns, or the first line that is not a valid expression
 */
export function parseGroupFilters(text: string | undefined | null): {
  patterns: RegExp[]
  error: string | null
} {
  const patterns: RegExp[] = []
  for (const { line, number } of entryLines(text)) {
    try {
      patterns.push(new RegExp(line, 'i'))
    } catch (err: any) {
      return {
        patterns: [],
        error: `Line ${number}: "${line}" is not a valid regular expression (${err.message}).`
      }
    }
  }
  return { patterns, error: null }
}

/**
 * The mappings: one `provider group -> wiki group` per line, both sides compared ignoring case as every
 * group name is. A provider group may be listed more than once to land in several wiki groups. The wiki
 * side follows the rule every group name does (`groups.validateName`): no `<`, `>` or `"`.
 *
 * @returns The mappings, or the first line that is not one
 */
export function parseGroupMappings(text: string | undefined | null): {
  mappings: GroupMapping[]
  error: string | null
} {
  const mappings: GroupMapping[] = []
  for (const { line, number } of entryLines(text)) {
    const at = line.indexOf(MAPPING_ARROW)
    const from = at < 0 ? '' : line.slice(0, at).trim()
    const to = at < 0 ? '' : line.slice(at + MAPPING_ARROW.length).trim()
    if (!from || !to) {
      return {
        mappings: [],
        error: `Line ${number}: "${line}" is not "provider group ${MAPPING_ARROW} wiki group".`
      }
    }
    if (!/^[^<>"]+$/.test(to)) {
      return {
        mappings: [],
        error: `Line ${number}: the wiki group name "${to}" cannot contain <, > or ".`
      }
    }
    mappings.push({ from, to })
  }
  return { mappings, error: null }
}

/**
 * Apply the ignore list and then the mappings to the names a provider sent.
 *
 * A mapped group is REPLACED by what it maps to: `ItAdmins -> Administrators` puts the person in
 * Administrators and not in a group called ItAdmins as well. Names come back unique, ignoring case,
 * in the order they were first seen.
 *
 * @returns What is left to match, and what the ignore list took out (for the debug log)
 */
export function applyGroupRules(
  names: string[],
  { patterns, mappings }: { patterns: RegExp[]; mappings: GroupMapping[] }
): { names: string[]; ignored: string[] } {
  const ignored = names.filter((name) => patterns.some((re) => re.test(name)))
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (ignored.includes(name)) {
      continue
    }
    const targets = mappings
      .filter((m) => m.from.toLowerCase() === name.toLowerCase())
      .map((m) => m.to)
    for (const target of targets.length > 0 ? targets : [name]) {
      if (!seen.has(target.toLowerCase())) {
        seen.add(target.toLowerCase())
        out.push(target)
      }
    }
  }
  return { names: out, ignored }
}

/** What a module prop's `format` names, and how a value of it is checked. See `ModulePropDefinition`. */
export const PROP_FORMAT_CHECKS: Record<string, (value: string) => string | null> = {
  regexList: (value) => parseGroupFilters(value).error,
  groupMappings: (value) => parseGroupMappings(value).error
}
