function splitLines(text, ignoreLineEndings) {
  const value = ignoreLineEndings ? text.replace(/\r\n?/g, "\n") : text.replace(/\r\n/g, "\n");
  if (value.length === 0) return [];
  return value.split("\n");
}

function normalizeLine(line, options) {
  let value = line;
  if (options.ignoreIndent) value = value.replace(/^[\t ]+/, "");
  if (options.ignoreWhitespace) value = value.replace(/\s+/g, "");
  if (options.ignoreCase) value = value.toLowerCase();
  return value;
}

function prepareLines(text, options) {
  const lines = splitLines(text, options.ignoreLineEndings).map((text, index) => ({
    text,
    originalNumber: index + 1,
    key: normalizeLine(text, options)
  }));
  return options.ignoreBlank ? lines.filter((line) => line.key.trim() !== "") : lines;
}

function patienceAnchors(left, right) {
  const leftMap = new Map();
  const rightMap = new Map();
  left.forEach((line, index) => {
    const item = leftMap.get(line.key) || { count: 0, index };
    item.count += 1;
    item.index = index;
    leftMap.set(line.key, item);
  });
  right.forEach((line, index) => {
    const item = rightMap.get(line.key) || { count: 0, index };
    item.count += 1;
    item.index = index;
    rightMap.set(line.key, item);
  });
  const candidates = [];
  leftMap.forEach((leftItem, key) => {
    const rightItem = rightMap.get(key);
    if (leftItem.count === 1 && rightItem && rightItem.count === 1) {
      candidates.push({ left: leftItem.index, right: rightItem.index });
    }
  });
  candidates.sort((a, b) => a.left - b.left);
  const piles = [];
  const parents = new Array(candidates.length).fill(-1);
  const pileTops = [];
  candidates.forEach((candidate, index) => {
    let low = 0;
    let high = piles.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (candidates[piles[mid]].right < candidate.right) low = mid + 1;
      else high = mid;
    }
    if (low > 0) parents[index] = piles[low - 1];
    piles[low] = index;
    pileTops[low] = index;
  });
  const result = [];
  let index = pileTops[piles.length - 1];
  while (index !== undefined && index !== -1) {
    result.push(candidates[index]);
    index = parents[index];
  }
  return result.reverse();
}

function lcsDiff(left, right) {
  const m = left.length;
  const n = right.length;
  if (m === 0) return right.map((line) => ({ type: "add", right: line }));
  if (n === 0) return left.map((line) => ({ type: "delete", left: line }));
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i].key === right[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (left[i].key === right[j].key) {
      ops.push({ type: "equal", left: left[i], right: right[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", left: left[i] });
      i += 1;
    } else {
      ops.push({ type: "add", right: right[j] });
      j += 1;
    }
  }
  while (i < m) ops.push({ type: "delete", left: left[i++] });
  while (j < n) ops.push({ type: "add", right: right[j++] });
  return ops;
}

function fallbackDiff(left, right) {
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].key === right[j].key) {
      ops.push({ type: "equal", left: left[i++], right: right[j++] });
    } else if (j + 1 < right.length && i < left.length && left[i].key === right[j + 1].key) {
      ops.push({ type: "add", right: right[j++] });
    } else if (i + 1 < left.length && j < right.length && left[i + 1].key === right[j].key) {
      ops.push({ type: "delete", left: left[i++] });
    } else {
      if (i < left.length) ops.push({ type: "delete", left: left[i++] });
      if (j < right.length) ops.push({ type: "add", right: right[j++] });
    }
  }
  return ops;
}

function diffRange(left, right) {
  if (!left.length && !right.length) return [];
  const cellCount = left.length * right.length;
  if (cellCount <= 1600000) return lcsDiff(left, right);
  return fallbackDiff(left, right);
}

function anchoredDiff(left, right) {
  if (left.length * right.length <= 1600000) return lcsDiff(left, right);
  const anchors = patienceAnchors(left, right);
  const ops = [];
  let li = 0;
  let ri = 0;
  anchors.forEach((anchor) => {
    ops.push(...diffRange(left.slice(li, anchor.left), right.slice(ri, anchor.right)));
    ops.push({ type: "equal", left: left[anchor.left], right: right[anchor.right] });
    li = anchor.left + 1;
    ri = anchor.right + 1;
  });
  ops.push(...diffRange(left.slice(li), right.slice(ri)));
  return ops;
}

function statsFor(ops) {
  return ops.reduce(
    (stats, op) => {
      if (op.type === "add") stats.added += 1;
      if (op.type === "delete") stats.removed += 1;
      if (op.type === "equal") stats.unchanged += 1;
      return stats;
    },
    { added: 0, removed: 0, unchanged: 0 }
  );
}

self.onmessage = (event) => {
  const { id, leftText, rightText, options } = event.data;
  const start = performance.now();
  try {
    const left = prepareLines(leftText, options);
    const right = prepareLines(rightText, options);
    const ops = anchoredDiff(left, right);
    const stats = statsFor(ops);
    stats.totalChanges = stats.added + stats.removed;
    self.postMessage({
      id,
      ok: true,
      ops,
      stats,
      elapsed: Math.round(performance.now() - start),
      leftLineCount: left.length,
      rightLineCount: right.length
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || String(error) });
  }
};
