// A small offline Markdown subset. All model text becomes text nodes, never HTML.
function inline(target, source) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g; let offset = 0;
  for (const match of source.matchAll(pattern)) {
    target.append(document.createTextNode(source.slice(offset, match.index)));
    const strong = match[0].startsWith("**"); const node = document.createElement(strong ? "strong" : "code");
    node.textContent = match[0].slice(strong ? 2 : 1, strong ? -2 : -1); target.append(node); offset = match.index + match[0].length;
  }
  target.append(document.createTextNode(source.slice(offset)));
}

export function renderAnswer(target, content) {
  const fragment = document.createDocumentFragment(); const lines = content.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]; if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      const wrapper = document.createElement("div"); wrapper.className = "code-block";
      const header = document.createElement("div"); header.className = "code-head";
      const label = document.createElement("span"); label.textContent = line.trim().slice(3) || "代码";
      const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; button.dataset.copyCode = ""; button.textContent = "复制代码";
      header.append(label, button); const codeLines = [];
      for (index += 1; index < lines.length && !/^\s*```\s*$/.test(lines[index]); index += 1) codeLines.push(lines[index]);
      const pre = document.createElement("pre"); const code = document.createElement("code"); code.textContent = codeLines.join("\n");
      pre.append(code); wrapper.append(header, pre); fragment.append(wrapper); continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) { const node = document.createElement("h3"); inline(node, heading[1]); fragment.append(node); continue; }
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (item) {
      const ordered = /^\s*\d+\./.test(line); const list = document.createElement(ordered ? "ol" : "ul");
      if (ordered) list.start = Number(line.match(/\d+/)[0]);
      const rule = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index].match(rule); if (!match) { index -= 1; break; }
        const li = document.createElement("li"); inline(li, match[1]); list.append(li); index += 1;
      }
      fragment.append(list); continue;
    }
    const paragraph = document.createElement("p"); inline(paragraph, line); fragment.append(paragraph);
  }
  target.replaceChildren(fragment);
}
