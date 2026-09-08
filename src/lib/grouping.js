// Pure grouping logic. No DOM access here, so it can be unit-tested with `node --test`.
//
// Input : [{ name: 'proj-dev-backend', type: 'channel' | 'private' | 'im' | 'mpim' | null }, ...]
//         in sidebar order.
// Output: one row per input item, same order.
//   { name, grouped: false }
//   { name, grouped: true, columns: [{ label, showLabel, glyph }, ...], leaf }
//
// A channel is grouped at depth d when the previous or next item shares its first d
// name segments. Segments are split on '-' and '_'. Rows render as
//   <label><glyph> per column, then <leaf>
// e.g.  proj┬dev┬backend
//           │   └frontend
//           └ops

const SEPARATOR = /([-_])/;

export const GLYPH = Object.freeze({
  first: '┬', // first item of a group (opens the branch)
  middle: '├', // inner item of a group
  last: '└', // last item of a group
  pass: '│', // the group continues below, but this row belongs to a deeper group
  blank: ' ', // the group ends here, and this row belongs to a deeper group
});

const DEFAULT_MAX_DEPTH = 3;

function isGroupable(name, type) {
  return name !== '' && type !== 'im' && type !== 'mpim';
}

// 'proj-dev_x' -> ['proj', '-', 'dev', '_', 'x'] (segments at even indexes, separators at odd)
function tokenize(name) {
  return name.split(SEPARATOR);
}

function segmentCount(tokens) {
  return (tokens.length + 1) / 2;
}

// First `depth` segments joined with their original separators, or null when too short.
function prefixOf(tokens, depth) {
  if (tokens === null || segmentCount(tokens) < depth) {
    return null;
  }
  return tokens.slice(0, 2 * depth - 1).join('');
}

export function groupChannels(items, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const parsed = items.map(({ name, type }) => (isGroupable(name, type) ? tokenize(name) : null));

  const shares = (i, j, depth) => {
    if (j < 0 || j >= parsed.length) {
      return false;
    }
    const prefix = prefixOf(parsed[i], depth);
    return prefix !== null && prefix === prefixOf(parsed[j], depth);
  };

  return items.map(({ name }, i) => {
    const tokens = parsed[i];
    if (tokens === null) {
      return { name, grouped: false };
    }

    let depth = 0;
    while (depth < maxDepth && (shares(i, i - 1, depth + 1) || shares(i, i + 1, depth + 1))) {
      depth += 1;
    }
    if (depth === 0) {
      return { name, grouped: false };
    }

    const columns = [];
    for (let d = 1; d <= depth; d += 1) {
      const first = !shares(i, i - 1, d);
      const hasNext = shares(i, i + 1, d);
      const insideDeeperGroup = d < depth && shares(i, i - 1, d + 1);

      let glyph;
      if (insideDeeperGroup) {
        glyph = hasNext ? GLYPH.pass : GLYPH.blank;
      } else if (first) {
        glyph = GLYPH.first;
      } else {
        glyph = hasNext ? GLYPH.middle : GLYPH.last;
      }

      columns.push({ label: tokens[2 * (d - 1)], showLabel: first, glyph });
    }

    const leaf = tokens.slice(2 * depth).join('') || '/';
    return { name, grouped: true, columns, leaf };
  });
}
