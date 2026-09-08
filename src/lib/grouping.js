// Pure grouping logic. No DOM access here, so it can be unit-tested with `node --test`.
//
// Input : [{ name: 'proj-dev-backend', type: 'channel' | 'private' | 'im' | 'mpim' | null,
//            unread?: boolean, mentions?: number }, ...] in sidebar order.
// Output: one row per input item, same order.
//   { name, grouped: false, hidden }
//   { name, grouped: true, hidden, columns: [{ label, showLabel, glyph, key }, ...], leaf,
//     foldedAt?, foldedCount?, foldedUnread?, foldedMentions? }
//
// A channel is grouped at depth d when the previous or next item shares its first d
// name segments. Segments are split on '-' and '_'. Rows render as
//   <label><glyph> per column, then <leaf>
// e.g.  proj┬dev┬backend
//           │   └frontend
//           └ops
//
// Folding: `folded` is a Set of column keys (the prefix at that depth, e.g. 'proj' or
// 'proj-dev'). A folded group keeps its first row, which gets foldedAt/foldedCount and the
// aggregated unread state of the rows it hides; every other row of the group is hidden.

const SEPARATOR = /([-_])/;

export const GLYPH = Object.freeze({
  first: '┬', // first item of a group (opens the branch)
  middle: '├', // inner item of a group
  last: '└', // last item of a group
  pass: '│', // the group continues below, but this row belongs to a deeper group
  blank: ' ', // the group ends here, and this row belongs to a deeper group
  folded: '▸', // first item of a folded group
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

export function groupChannels(items, { maxDepth = DEFAULT_MAX_DEPTH, folded = new Set() } = {}) {
  const parsed = items.map(({ name, type }) => (isGroupable(name, type) ? tokenize(name) : null));
  const count = items.length;

  const shares = (i, j, depth) => {
    if (j < 0 || j >= count) {
      return false;
    }
    const prefix = prefixOf(parsed[i], depth);
    return prefix !== null && prefix === prefixOf(parsed[j], depth);
  };

  const depthOf = (i) => {
    let depth = 0;
    while (depth < maxDepth && (shares(i, i - 1, depth + 1) || shares(i, i + 1, depth + 1))) {
      depth += 1;
    }
    return depth;
  };

  // Index of the last row of the group that starts at `first` at `depth`.
  const groupEnd = (first, depth) => {
    let end = first;
    while (end + 1 < count && shares(end + 1, first, depth)) {
      end += 1;
    }
    return end;
  };

  // Folding pass: which rows are hidden, and which first rows stand in for a folded group.
  const hidden = new Array(count).fill(false);
  const foldInfo = new Array(count).fill(null);
  for (let i = 0; i < count; i += 1) {
    if (parsed[i] === null) {
      continue;
    }
    const depth = depthOf(i);
    for (let d = 1; d <= depth; d += 1) {
      if (shares(i, i - 1, d) || !folded.has(prefixOf(parsed[i], d))) {
        continue; // not the first row of the group at d, or the group is open
      }
      const end = groupEnd(i, d);
      const info = !hidden[i] && foldInfo[i] === null ? { at: d, count: end - i + 1, unread: false, mentions: 0 } : null;
      for (let j = i + 1; j <= end; j += 1) {
        hidden[j] = true;
        if (info) {
          info.unread = info.unread || items[j].unread === true;
          info.mentions += items[j].mentions ?? 0;
        }
      }
      if (info) {
        foldInfo[i] = info;
      }
    }
  }

  return items.map(({ name }, i) => {
    const tokens = parsed[i];
    if (tokens === null) {
      return { name, grouped: false, hidden: false };
    }

    const depth = depthOf(i);
    if (depth === 0) {
      return { name, grouped: false, hidden: false };
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

      columns.push({ label: tokens[2 * (d - 1)], showLabel: first, glyph, key: prefixOf(tokens, d) });
    }

    const leaf = tokens.slice(2 * depth).join('') || '/';
    const row = { name, grouped: true, hidden: hidden[i], columns, leaf };

    const info = foldInfo[i];
    if (info) {
      row.columns = columns.slice(0, info.at);
      row.columns[info.at - 1] = { ...row.columns[info.at - 1], glyph: GLYPH.folded };
      row.leaf = tokens.slice(2 * info.at).join('') || '/';
      row.foldedAt = info.at;
      row.foldedCount = info.count;
      row.foldedUnread = info.unread;
      row.foldedMentions = info.mentions;
    }
    return row;
  });
}
