const $ = (id) => document.getElementById(id);

const els = {
  leftText: $("leftText"),
  rightText: $("rightText"),
  leftMeta: $("leftMeta"),
  rightMeta: $("rightMeta"),
  leftFile: $("leftFile"),
  rightFile: $("rightFile"),
  leftDrop: $("leftDrop"),
  rightDrop: $("rightDrop"),
  leftUrl: $("leftUrl"),
  rightUrl: $("rightUrl"),
  leftFetch: $("leftFetch"),
  rightFetch: $("rightFetch"),
  sideViewBtn: $("sideViewBtn"),
  unifiedViewBtn: $("unifiedViewBtn"),
  languageSelect: $("languageSelect"),
  precisionSelect: $("precisionSelect"),
  diffBtn: $("diffBtn"),
  themeSelect: $("themeSelect"),
  ignoreWhitespace: $("ignoreWhitespace"),
  ignoreCase: $("ignoreCase"),
  ignoreBlank: $("ignoreBlank"),
  ignoreIndent: $("ignoreIndent"),
  ignoreLineEndings: $("ignoreLineEndings"),
  wrapToggle: $("wrapToggle"),
  syncToggle: $("syncToggle"),
  collapseToggle: $("collapseToggle"),
  summary: $("summary"),
  addedCount: $("addedCount"),
  removedCount: $("removedCount"),
  unchangedCount: $("unchangedCount"),
  changedCount: $("changedCount"),
  progress: $("progress"),
  emptyState: $("emptyState"),
  diffOutput: $("diffOutput"),
  changeList: $("changeList"),
  historyList: $("historyList"),
  firstBtn: $("firstBtn"),
  prevBtn: $("prevBtn"),
  nextBtn: $("nextBtn"),
  lastBtn: $("lastBtn"),
  copyDiffBtn: $("copyDiffBtn"),
  exportPatchBtn: $("exportPatchBtn"),
  exportHtmlBtn: $("exportHtmlBtn"),
  exportMarkdownBtn: $("exportMarkdownBtn"),
  exportJsonBtn: $("exportJsonBtn"),
  saveSessionBtn: $("saveSessionBtn"),
  toast: $("toast")
};

let worker;
let requestId = 0;
let currentView = "side";
let currentOps = [];
let sideRows = [];
let currentStats = { added: 0, removed: 0, unchanged: 0, totalChanges: 0 };
let changeBlocks = [];
let activeChange = -1;
let leftInfo = { filename: "original.txt", language: "plain", size: 0, lines: 0 };
let rightInfo = { filename: "modified.txt", language: "plain", size: 0, lines: 0 };
let renderAbort = 0;

const languageExtensions = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  html: "html",
  htm: "html",
  css: "css",
  json: "json"
};

const sampleLeft = `function greet(name) {
  console.log("Hello, " + name);
}

function farewell(name) {
  console.log("Goodbye, " + name);
}`;

const sampleRight = `function greet(name) {
  console.log("Hello, " + name + "!");
  console.log("Have a great day!");
}

function farewell(name) {
  console.log("Goodbye, " + name + "!");
}`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function lineCount(text) {
  return text ? text.replace(/\r\n?/g, "\n").split("\n").length : 0;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function detectLanguage(text, filename = "") {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension && languageExtensions[extension]) return languageExtensions[extension];
  const trimmed = text.trim();
  if (!trimmed) return "plain";
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && /"[^"]+"\s*:/.test(trimmed)) return "json";
  if (/^\s*<!doctype html/i.test(trimmed) || /<\/?[a-z][\s\S]*>/i.test(trimmed)) return "html";
  if (/^\s*(def|class|import|from)\s+/m.test(trimmed) || /:\s*(#.*)?$/m.test(trimmed)) return "python";
  if (/[.#][\w-]+\s*\{[\s\S]*\}/.test(trimmed) && /;\s*$/m.test(trimmed)) return "css";
  if (/\b(function|const|let|var|=>|console\.log)\b/.test(trimmed)) return "javascript";
  return "plain";
}

function chosenLanguage(text = "") {
  return els.languageSelect.value === "auto"
    ? detectLanguage(text || `${els.leftText.value}\n${els.rightText.value}`, leftInfo.filename)
    : els.languageSelect.value;
}

function updateMeta(side, info) {
  const target = side === "left" ? els.leftMeta : els.rightMeta;
  target.textContent = `${info.filename} | ${formatBytes(info.size)} | ${info.language} | ${info.lines} lines`;
}

function setText(side, text, filename = side === "left" ? "original.txt" : "modified.txt", size = new Blob([text]).size) {
  const info = {
    filename,
    language: detectLanguage(text, filename),
    size,
    lines: lineCount(text)
  };
  if (side === "left") {
    els.leftText.value = text;
    leftInfo = info;
  } else {
    els.rightText.value = text;
    rightInfo = info;
  }
  updateMeta(side, info);
  if (els.languageSelect.value === "auto") toast(`${filename} detected as ${info.language}`);
  scheduleDiff();
}

function getOptions() {
  return {
    ignoreWhitespace: els.ignoreWhitespace.checked,
    ignoreCase: els.ignoreCase.checked,
    ignoreBlank: els.ignoreBlank.checked,
    ignoreIndent: els.ignoreIndent.checked,
    ignoreLineEndings: els.ignoreLineEndings.checked
  };
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker("diff-worker.js");
  worker.onmessage = (event) => {
    const data = event.data;
    if (data.id !== requestId) return;
    els.progress.hidden = true;
    if (!data.ok) {
      toast(data.error);
      return;
    }
    currentOps = data.ops;
    currentStats = data.stats;
    updateSummary();
    buildRows();
    buildChangeBlocks();
    renderAll();
    saveHistory(false);
    toast(`Diff computed in ${data.elapsed} ms`);
  };
  return worker;
}

function computeDiff() {
  requestId += 1;
  els.progress.hidden = false;
  ensureWorker().postMessage({
    id: requestId,
    leftText: els.leftText.value,
    rightText: els.rightText.value,
    options: getOptions()
  });
}

let diffTimer;
function scheduleDiff() {
  window.clearTimeout(diffTimer);
  diffTimer = window.setTimeout(computeDiff, 260);
}

function updateSummary() {
  els.addedCount.textContent = currentStats.added;
  els.removedCount.textContent = currentStats.removed;
  els.unchangedCount.textContent = currentStats.unchanged;
  els.changedCount.textContent = currentStats.totalChanges;
  els.summary.setAttribute(
    "aria-label",
    `${currentStats.added} lines added, ${currentStats.removed} removed, ${currentStats.unchanged} unchanged`
  );
}

function buildRows() {
  const rows = [];
  for (let i = 0; i < currentOps.length; i += 1) {
    const op = currentOps[i];
    if (op.type === "equal") {
      rows.push({ type: "equal", left: op.left, right: op.right });
      continue;
    }
    const deletes = [];
    const adds = [];
    while (currentOps[i] && currentOps[i].type !== "equal") {
      if (currentOps[i].type === "delete") deletes.push(currentOps[i].left);
      if (currentOps[i].type === "add") adds.push(currentOps[i].right);
      i += 1;
    }
    i -= 1;
    const paired = Math.min(deletes.length, adds.length);
    for (let p = 0; p < paired; p += 1) rows.push({ type: "modify", left: deletes[p], right: adds[p] });
    for (let d = paired; d < deletes.length; d += 1) rows.push({ type: "delete", left: deletes[d] });
    for (let a = paired; a < adds.length; a += 1) rows.push({ type: "add", right: adds[a] });
  }
  sideRows = rows;
}

function buildChangeBlocks() {
  const rows = currentView === "side" ? sideRows : currentOps;
  changeBlocks = [];
  let start = -1;
  let preview = "";
  rows.forEach((row, index) => {
    const changed = row.type !== "equal";
    if (changed && start === -1) {
      start = index;
      preview = (row.left?.text || row.right?.text || "").trim();
    }
    if ((!changed || index === rows.length - 1) && start !== -1) {
      const end = changed && index === rows.length - 1 ? index : index - 1;
      const blockRows = rows.slice(start, end + 1);
      const leftNums = blockRows.map((item) => item.left?.originalNumber).filter(Boolean);
      const rightNums = blockRows.map((item) => item.right?.originalNumber).filter(Boolean);
      changeBlocks.push({
        start,
        end,
        preview: preview || "Changed blank line",
        leftRange: rangeText(leftNums),
        rightRange: rangeText(rightNums)
      });
      start = -1;
    }
  });
  activeChange = changeBlocks.length ? 0 : -1;
  renderChangeList();
}

function rangeText(nums) {
  if (!nums.length) return "-";
  return nums.length === 1 ? String(nums[0]) : `${nums[0]}-${nums[nums.length - 1]}`;
}

function tokenise(value, mode) {
  if (mode === "char") return Array.from(value);
  const tokens = value.match(/(\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$])/g);
  return tokens || [];
}

function inlineDiff(left, right, mode) {
  const precision = mode === "smart" ? "word" : mode;
  if (precision === "none") return [escapeHtml(left), escapeHtml(right)];
  const a = tokenise(left, precision);
  const b = tokenise(right, precision);
  const m = a.length;
  const n = b.length;
  if (m * n > 90000) return [escapeHtml(left), escapeHtml(right)];
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  let leftHtml = "";
  let rightHtml = "";
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      const token = escapeHtml(a[i]);
      leftHtml += token;
      rightHtml += token;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      leftHtml += `<span class="inline-del">${escapeHtml(a[i++])}</span>`;
    } else {
      rightHtml += `<span class="inline-add">${escapeHtml(b[j++])}</span>`;
    }
  }
  while (i < m) leftHtml += `<span class="inline-del">${escapeHtml(a[i++])}</span>`;
  while (j < n) rightHtml += `<span class="inline-add">${escapeHtml(b[j++])}</span>`;
  return [leftHtml, rightHtml];
}

function highlight(value, language) {
  let html = escapeHtml(value);
  if (language === "plain") return html;
  if (language === "json") {
    html = html.replace(/(&quot;.*?&quot;)(\s*:)?/g, (_, key, colon) =>
      colon ? `<span class="tok-keyword">${key}</span>${colon}` : `<span class="tok-string">${key}</span>`
    );
  }
  if (language === "html") {
    html = html.replace(/(&lt;\/?[\w-]+|\/?&gt;)/g, '<span class="tok-tag">$1</span>');
  }
  html = html
    .replace(/(&quot;.*?&quot;|'.*?'|`.*?`)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  if (language === "javascript") {
    html = html.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|try|catch)\b/g, '<span class="tok-keyword">$1</span>');
  }
  if (language === "python") {
    html = html.replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|lambda|True|False|None)\b/g, '<span class="tok-keyword">$1</span>');
  }
  if (language === "css") {
    html = html.replace(/([\w-]+)(\s*:)/g, '<span class="tok-keyword">$1</span>$2');
  }
  html = html.replace(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm, '<span class="tok-comment">$1</span>');
  return html;
}

function renderLine(value, language, existingHtml) {
  return existingHtml ?? highlight(value, language);
}

function visibleGroups(rows) {
  if (!els.collapseToggle.checked) return rows.map((row, index) => ({ type: "row", row, index }));
  const groups = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "equal") {
      groups.push({ type: "row", row: rows[i], index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].type === "equal") j += 1;
    const count = j - i;
    if (count > 12) {
      rows.slice(i, i + 4).forEach((row, offset) => groups.push({ type: "row", row, index: i + offset }));
      groups.push({ type: "collapsed", start: i + 4, end: j - 5, count: count - 8 });
      rows.slice(j - 4, j).forEach((row, offset) => groups.push({ type: "row", row, index: j - 4 + offset }));
    } else {
      rows.slice(i, j).forEach((row, offset) => groups.push({ type: "row", row, index: i + offset }));
    }
    i = j;
  }
  return groups;
}

function renderSide() {
  const language = chosenLanguage();
  const precision = els.precisionSelect.value;
  const groups = visibleGroups(sideRows);
  const container = document.createElement("div");
  container.className = "side-scrolls";
  const leftPane = document.createElement("div");
  const rightPane = document.createElement("div");
  leftPane.className = "side-pane";
  rightPane.className = "side-pane";
  leftPane.innerHTML = `<div class="side-pane-header"><div></div><div>Original</div></div>`;
  rightPane.innerHTML = `<div class="side-pane-header"><div></div><div>Modified</div></div>`;
  container.append(leftPane, rightPane);
  const myAbort = ++renderAbort;
  let index = 0;
  function chunk() {
    if (myAbort !== renderAbort) return;
    const leftFrag = document.createDocumentFragment();
    const rightFrag = document.createDocumentFragment();
    const limit = Math.min(index + 350, groups.length);
    for (; index < limit; index += 1) {
      const group = groups[index];
      if (group.type === "collapsed") {
        const expand = () => {
          els.collapseToggle.checked = false;
          renderAll();
        };
        const leftButton = document.createElement("button");
        const rightButton = document.createElement("button");
        leftButton.className = rightButton.className = "collapsed";
        leftButton.type = rightButton.type = "button";
        leftButton.textContent = rightButton.textContent = `... ${group.count} unchanged lines ...`;
        leftButton.addEventListener("click", expand);
        rightButton.addEventListener("click", expand);
        leftFrag.append(leftButton);
        rightFrag.append(rightButton);
        continue;
      }
      const row = group.row;
      const [leftInline, rightInline] =
        row.type === "modify" ? inlineDiff(row.left.text, row.right.text, precision) : [undefined, undefined];
      const leftDiv = document.createElement("div");
      const rightDiv = document.createElement("div");
      leftDiv.className = `side-pane-row ${row.type}`;
      rightDiv.className = `side-pane-row ${row.type}`;
      leftDiv.id = `diff-row-${group.index}`;
      leftDiv.innerHTML = `
        <div class="line-no">${row.left?.originalNumber || ""}</div>
        <div class="code left-code">${row.left ? renderLine(row.left.text, language, leftInline) : ""}</div>`;
      rightDiv.innerHTML = `
        <div class="line-no">${row.right?.originalNumber || ""}</div>
        <div class="code right-code">${row.right ? renderLine(row.right.text, language, rightInline) : ""}</div>`;
      leftFrag.append(leftDiv);
      rightFrag.append(rightDiv);
    }
    leftPane.append(leftFrag);
    rightPane.append(rightFrag);
    if (index < groups.length) requestAnimationFrame(chunk);
    else requestAnimationFrame(() => equalizeSideRowHeights(leftPane, rightPane));
  }
  chunk();
  bindPaneSync(leftPane, rightPane);
  els.diffOutput.replaceChildren(container);
}

function equalizeSideRowHeights(leftPane, rightPane) {
  const leftRows = Array.from(leftPane.querySelectorAll(".side-pane-row, .collapsed"));
  const rightRows = Array.from(rightPane.querySelectorAll(".side-pane-row, .collapsed"));
  leftRows.forEach((leftRow, index) => {
    const rightRow = rightRows[index];
    if (!rightRow) return;
    leftRow.style.minHeight = "";
    rightRow.style.minHeight = "";
    const height = Math.max(leftRow.offsetHeight, rightRow.offsetHeight);
    leftRow.style.minHeight = `${height}px`;
    rightRow.style.minHeight = `${height}px`;
  });
}

function bindPaneSync(leftPane, rightPane) {
  let syncing = false;
  const mirror = (source, target) => {
    if (!els.syncToggle.checked || syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncing = false;
    });
  };
  leftPane.addEventListener("scroll", () => mirror(leftPane, rightPane));
  rightPane.addEventListener("scroll", () => mirror(rightPane, leftPane));
}

function hunkHeader(rows) {
  const leftNums = rows.map((row) => row.left?.originalNumber).filter(Boolean);
  const rightNums = rows.map((row) => row.right?.originalNumber).filter(Boolean);
  const leftStart = leftNums[0] || 0;
  const rightStart = rightNums[0] || 0;
  return `@@ -${leftStart},${leftNums.length} +${rightStart},${rightNums.length} @@`;
}

function unifiedRows() {
  const rows = [];
  for (let i = 0; i < currentOps.length; i += 1) {
    const op = currentOps[i];
    if (op.type === "equal") rows.push({ type: "equal", left: op.left, right: op.right, text: op.left.text, prefix: " " });
    if (op.type === "delete") rows.push({ type: "delete", left: op.left, text: op.left.text, prefix: "-" });
    if (op.type === "add") rows.push({ type: "add", right: op.right, text: op.right.text, prefix: "+" });
  }
  return rows;
}

function renderUnified() {
  const language = chosenLanguage();
  const rows = visibleGroups(unifiedRows());
  const container = document.createElement("div");
  container.className = "unified";
  container.innerHTML = `<div class="hunk">${hunkHeader(unifiedRows())}</div>`;
  const frag = document.createDocumentFragment();
  rows.forEach((group) => {
    if (group.type === "collapsed") {
      const button = document.createElement("button");
      button.className = "collapsed";
      button.type = "button";
      button.textContent = `... ${group.count} unchanged lines ...`;
      button.addEventListener("click", () => {
        els.collapseToggle.checked = false;
        renderAll();
      });
      frag.append(button);
      return;
    }
    const row = group.row;
    const div = document.createElement("div");
    div.className = `uni-row ${row.type}`;
    div.id = `diff-row-${group.index}`;
    div.innerHTML = `
      <div class="prefix">${escapeHtml(row.prefix)}</div>
      <div class="line-no">${row.left?.originalNumber || ""}</div>
      <div class="line-no">${row.right?.originalNumber || ""}</div>
      <div class="line-text">${highlight(row.text, language)}</div>`;
    frag.append(div);
  });
  container.append(frag);
  els.diffOutput.replaceChildren(container);
}

function renderAll() {
  els.emptyState.hidden = currentOps.length > 0;
  els.diffOutput.classList.toggle("visible", currentOps.length > 0);
  els.diffOutput.classList.toggle("wrap", els.wrapToggle.checked);
  if (!currentOps.length) return;
  buildChangeBlocks();
  if (currentView === "side") renderSide();
  else renderUnified();
}

function renderChangeList() {
  els.changeList.replaceChildren();
  if (!changeBlocks.length) {
    const empty = document.createElement("p");
    empty.className = "change-card";
    empty.textContent = "No changes";
    els.changeList.append(empty);
    return;
  }
  changeBlocks.forEach((block, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `change-card${index === activeChange ? " active" : ""}`;
    button.innerHTML = `<strong>Change ${index + 1}</strong><span>-${block.leftRange} +${block.rightRange}</span><span>${escapeHtml(block.preview)}</span>`;
    button.addEventListener("click", () => jumpToChange(index));
    els.changeList.append(button);
  });
}

function jumpToChange(index) {
  if (!changeBlocks.length) return;
  activeChange = Math.max(0, Math.min(index, changeBlocks.length - 1));
  renderChangeList();
  const target = $(`diff-row-${changeBlocks[activeChange].start}`);
  if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function makeUnifiedPatch() {
  const oldName = leftInfo.filename || "original.txt";
  const newName = rightInfo.filename || "modified.txt";
  const lines = [`--- a/${oldName}`, `+++ b/${newName}`, hunkHeader(unifiedRows())];
  unifiedRows().forEach((row) => lines.push(`${row.prefix}${row.text}`));
  return `${lines.join("\n")}\n`;
}

function makeMarkdown() {
  return `# Diff\n\n${currentStats.added} added, ${currentStats.removed} removed, ${currentStats.unchanged} unchanged.\n\n\`\`\`diff\n${makeUnifiedPatch()}\`\`\`\n`;
}

function makeJson() {
  return JSON.stringify({ stats: currentStats, left: leftInfo, right: rightInfo, operations: currentOps }, null, 2);
}

function makeHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Diff</title><style>body{font-family:monospace}.add{background:#dcfce7}.delete{background:#fee2e2}.equal{color:#333}pre{margin:0;padding:2px 6px}</style></head><body>${unifiedRows()
    .map((row) => `<pre class="${row.type}">${escapeHtml(row.prefix + row.text)}</pre>`)
    .join("")}</body></html>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Copied to clipboard");
  }
}

function download(name, mime, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: mime }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function saveHistory(named) {
  const left = els.leftText.value;
  const right = els.rightText.value;
  if (!left && !right) return;
  const sessions = JSON.parse(localStorage.getItem("diffSessions") || "[]");
  const name = named ? prompt("Session name", `${leftInfo.filename} -> ${rightInfo.filename}`) : `${leftInfo.filename} -> ${rightInfo.filename}`;
  if (named && !name) return;
  const entry = {
    id: Date.now(),
    name,
    saved: new Date().toISOString(),
    left,
    right,
    leftInfo,
    rightInfo,
    stats: currentStats
  };
  sessions.unshift(entry);
  localStorage.setItem("diffSessions", JSON.stringify(sessions.slice(0, 12)));
  renderHistory();
  if (named) toast("Session saved");
}

function renderHistory() {
  const sessions = JSON.parse(localStorage.getItem("diffSessions") || "[]");
  els.historyList.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "change-card";
    empty.textContent = "No saved sessions";
    els.historyList.append(empty);
    return;
  }
  sessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "change-card";
    button.innerHTML = `<strong>${escapeHtml(session.name)}</strong><span>${new Date(session.saved).toLocaleString()}</span>`;
    button.addEventListener("click", () => {
      els.leftText.value = session.left;
      els.rightText.value = session.right;
      leftInfo = session.leftInfo;
      rightInfo = session.rightInfo;
      updateMeta("left", leftInfo);
      updateMeta("right", rightInfo);
      computeDiff();
    });
    els.historyList.append(button);
  });
}

async function loadFile(side, file) {
  const text = await file.text();
  setText(side, text, file.name, file.size);
}

function bindDrop(side, panel) {
  panel.addEventListener("dragover", (event) => {
    event.preventDefault();
    panel.classList.add("dragover");
  });
  panel.addEventListener("dragleave", () => panel.classList.remove("dragover"));
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    panel.classList.remove("dragover");
    const file = event.dataTransfer.files[0];
    if (file) loadFile(side, file);
  });
}

async function fetchUrl(side) {
  const input = side === "left" ? els.leftUrl : els.rightUrl;
  const url = input.value.trim();
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    const filename = new URL(url).pathname.split("/").pop() || "remote.txt";
    setText(side, text, filename, new Blob([text]).size);
  } catch (error) {
    toast(`Could not fetch URL: ${error.message}`);
  }
}

function setView(view) {
  currentView = view;
  els.sideViewBtn.classList.toggle("active", view === "side");
  els.unifiedViewBtn.classList.toggle("active", view === "unified");
  els.sideViewBtn.setAttribute("aria-selected", String(view === "side"));
  els.unifiedViewBtn.setAttribute("aria-selected", String(view === "unified"));
  renderAll();
}

function bindEvents() {
  els.diffBtn.addEventListener("click", computeDiff);
  els.leftText.addEventListener("input", () => {
    leftInfo = { filename: leftInfo.filename, language: detectLanguage(els.leftText.value, leftInfo.filename), size: new Blob([els.leftText.value]).size, lines: lineCount(els.leftText.value) };
    updateMeta("left", leftInfo);
    scheduleDiff();
  });
  els.rightText.addEventListener("input", () => {
    rightInfo = { filename: rightInfo.filename, language: detectLanguage(els.rightText.value, rightInfo.filename), size: new Blob([els.rightText.value]).size, lines: lineCount(els.rightText.value) };
    updateMeta("right", rightInfo);
    scheduleDiff();
  });
  [els.ignoreWhitespace, els.ignoreCase, els.ignoreBlank, els.ignoreIndent, els.ignoreLineEndings].forEach((el) => el.addEventListener("change", computeDiff));
  [els.wrapToggle, els.collapseToggle, els.precisionSelect, els.languageSelect, els.syncToggle].forEach((el) => el.addEventListener("change", renderAll));
  els.sideViewBtn.addEventListener("click", () => setView("side"));
  els.unifiedViewBtn.addEventListener("click", () => setView("unified"));
  els.leftFile.addEventListener("change", () => els.leftFile.files[0] && loadFile("left", els.leftFile.files[0]));
  els.rightFile.addEventListener("change", () => els.rightFile.files[0] && loadFile("right", els.rightFile.files[0]));
  els.leftFetch.addEventListener("click", () => fetchUrl("left"));
  els.rightFetch.addEventListener("click", () => fetchUrl("right"));
  bindDrop("left", els.leftDrop);
  bindDrop("right", els.rightDrop);
  els.nextBtn.addEventListener("click", () => jumpToChange(activeChange + 1));
  els.prevBtn.addEventListener("click", () => jumpToChange(activeChange - 1));
  els.firstBtn.addEventListener("click", () => jumpToChange(0));
  els.lastBtn.addEventListener("click", () => jumpToChange(changeBlocks.length - 1));
  els.copyDiffBtn.addEventListener("click", () => copyText(makeUnifiedPatch()));
  els.exportPatchBtn.addEventListener("click", () => download("diff.patch", "text/x-diff", makeUnifiedPatch()));
  els.exportHtmlBtn.addEventListener("click", () => download("diff.html", "text/html", makeHtml()));
  els.exportMarkdownBtn.addEventListener("click", () => download("diff.md", "text/markdown", makeMarkdown()));
  els.exportJsonBtn.addEventListener("click", () => download("diff.json", "application/json", makeJson()));
  els.saveSessionBtn.addEventListener("click", () => saveHistory(true));
  els.themeSelect.addEventListener("change", () => {
    localStorage.setItem("diffTheme", els.themeSelect.value);
    applyTheme();
  });
  document.addEventListener("keydown", (event) => {
    if (/textarea|input|select/i.test(event.target.tagName)) return;
    if (event.key.toLowerCase() === "j") jumpToChange(activeChange + 1);
    if (event.key.toLowerCase() === "k") jumpToChange(activeChange - 1);
    if (event.key.toLowerCase() === "g") jumpToChange(0);
    if (event.key.toLowerCase() === "e") jumpToChange(changeBlocks.length - 1);
  });
}

function applyTheme() {
  const theme = localStorage.getItem("diffTheme") || "system";
  els.themeSelect.value = theme;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("service-worker.js");
  } catch {
    /* Offline support is best effort on file:// and unsupported browsers. */
  }
}

function init() {
  applyTheme();
  bindEvents();
  setText("left", sampleLeft, "original.js");
  setText("right", sampleRight, "modified.js");
  renderHistory();
  registerServiceWorker();
}

init();
