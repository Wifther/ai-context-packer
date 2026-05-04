function minifyContent(content, lang = '') {
  let result = content;

  if (/^(javascript|jsx|typescript|tsx|css|scss|sass|less|java|kotlin|swift|go|rust|c|cpp|csharp|scala|php)$/.test(lang)) {
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  if (/^(javascript|jsx|typescript|tsx|java|kotlin|swift|go|rust|c|cpp|csharp|scala|php)$/.test(lang)) {
    result = result.replace(/^\s*\/\/.*$/gm, '');
  }

  if (/^(html|xml|xhtml|vue|svelte|markdown|mdx)$/.test(lang)) {
    result = result.replace(/<!--[\s\S]*?-->/g, '');
  }

  if (/^(python|ruby|bash|yaml|toml|dockerfile|)$/.test(lang) || lang === '') {
    result = result.replace(/^\s*#.*$/gm, '');
  }

  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');

  return result.trim();
}

function skeletonizePython(content) {
  const lines = content.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const defMatch = line.match(/^(\s*)(async\s+)?def\s+\w+\s*\(/);

    if (defMatch) {
      out.push(line);
      i++;
      const defIndent = defMatch[1].length;
      let foundBody = false;

      while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
          out.push(lines[i]);
          i++;
          continue;
        }
        const indent = lines[i].match(/^(\s*)/)[1].length;
        if (indent > defIndent) {
          if (!foundBody) {
            out.push(' '.repeat(indent) + 'pass');
            foundBody = true;
          }
          i++;
          while (i < lines.length) {
            const t = lines[i].trim();
            if (t === '' || t.startsWith('#')) {
              i++;
              continue;
            }
            const nextIndent = lines[i].match(/^(\s*)/)[1].length;
            if (nextIndent <= defIndent) break;
            i++;
          }
          break;
        }
        break;
      }
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join('\n');
}

function skeletonizeBraces(content, lang) {
  const lines = content.split('\n');
  const out = [];
  let i = 0;

  const isSignatureStart = (line) => {
    const t = line.trim();
    if (/^\s*(if|while|for|switch|catch|else|do|try|finally)\b/.test(t)) return false;

    if (['javascript', 'jsx', 'typescript', 'tsx'].includes(lang)) {
      if (/^\s*(export\s+|default\s+|async\s+)*function\s*\*?\s*\w*\s*\(/.test(t)) return true;
      if (/^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?(\([^)]*\)|[\w$]+)\s*=>/.test(t)) return true;
      if (/^\s*(async\s+|get\s+|set\s+|static\s+)*\w+\s*\([^)]*\)\s*\{/.test(t)) return true;
      if (/^\s*\w+\s*:\s*(async\s+)?function\s*\(/.test(t)) return true;
      if (/^\s*(export\s+|default\s+)*(class|interface|type)\s+\w/.test(t)) return false;
    }
    if (['java', 'kotlin'].includes(lang)) {
      if (/^\s*(public|private|protected|static|final|abstract|synchronized|override|open)\s+/.test(t) && /\([^)]*\)/.test(t) && !/class\s+\w/.test(t) && !/interface\s+\w/.test(t) && !/enum\s+\w/.test(t)) return true;
    }
    if (lang === 'rust') {
      if (/^\s*(pub\s+)?(async\s+)?fn\s+\w+\s*\(/.test(t)) return true;
    }
    if (['go', 'c', 'cpp', 'csharp', 'swift', 'scala', 'php'].includes(lang)) {
      if (/^\s*func\s+\w+\s*\(/.test(t)) return true;
      if (/^\s*\w+[\s\*]+\w+\s*\([^)]*\)\s*\{/.test(t) && !/^\s*(class|struct|interface|enum|namespace|using|import|package|module)\b/.test(t)) return true;
    }
    return false;
  };

  while (i < lines.length) {
    let line = lines[i];
    let sigLines = [line];
    let sigIdx = i;
    let hasBrace = line.includes('{');

    if (isSignatureStart(line) && !hasBrace) {
      let j = i + 1;
      while (j < Math.min(i + 8, lines.length) && !hasBrace) {
        sigLines.push(lines[j]);
        if (lines[j].includes('{')) {
          hasBrace = true;
          sigIdx = j;
          break;
        }
        j++;
      }
    }

    if (isSignatureStart(line) && hasBrace) {
      const lastSigLine = sigLines[sigLines.length - 1];
      const openIdx = lastSigLine.indexOf('{');

      for (let k = 0; k < sigLines.length - 1; k++) {
        out.push(sigLines[k]);
      }
      out.push(lastSigLine.slice(0, openIdx) + '{ }');
      i = sigIdx + 1;

      let depth = 1;
      let inString = false;
      let stringChar = '';
      let escaped = false;

      for (let j = openIdx + 1; j < lastSigLine.length; j++) {
        const ch = lastSigLine[j];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (!inString && (ch === '"' || ch === "'" || ch === '`')) { inString = true; stringChar = ch; continue; }
        if (inString && ch === stringChar) { inString = false; continue; }
        if (!inString) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
      }

      while (i < lines.length && depth > 0) {
        for (let j = 0; j < lines[i].length; j++) {
          const ch = lines[i][j];
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (!inString && (ch === '"' || ch === "'" || ch === '`')) { inString = true; stringChar = ch; continue; }
          if (inString && ch === stringChar) { inString = false; continue; }
          if (!inString) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
          }
        }
        i++;
      }
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join('\n');
}

export function skeletonize(content, lang) {
  if (!lang) return content;
  const l = lang.toLowerCase();

  if (l === 'python') return skeletonizePython(content);
  if (['javascript', 'jsx', 'typescript', 'tsx', 'java', 'rust', 'go', 'c', 'cpp', 'csharp', 'swift', 'kotlin', 'scala', 'php'].includes(l)) {
    return skeletonizeBraces(content, l);
  }

  return content;
}

export function buildMarkdown(collected, options = {}) {
  const { includeTree = true, minify = false, skeleton = false } = options;
  const { files, tree } = collected;

  const parts = [];

  parts.push('# Codebase Context');
  parts.push(`\n> Generated by **ai-context-packer** · ${files.length} file(s) included${minify ? ' · minified' : ''}${skeleton ? ' · skeleton' : ''}\n`);

  if (includeTree) {
    parts.push('## Project Structure\n');
    parts.push('```\n' + tree + '\n```\n');
  }

  parts.push('## Files\n');

  for (const file of files) {
    parts.push(`### \`${file.relativePosix}\`\n`);
    const fence = '```' + (file.lang || '');
    let content;
    if (skeleton) {
      content = skeletonize(file.content, file.lang);
    } else if (minify) {
      content = minifyContent(file.content, file.lang);
    } else {
      content = file.content;
    }
    parts.push(`${fence}\n${content}\n\`\`\`\n`);
  }

  return parts.join('\n');
}

export function buildXML(collected, options = {}) {
  const { includeTree = true, minify = false, skeleton = false } = options;
  const { files, tree } = collected;

  const lines = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<!-- Generated by ai-context-packer${minify ? ' | minified' : ''}${skeleton ? ' | skeleton' : ''} -->`);
  lines.push(`<codebase file_count="${files.length}">`);

  if (includeTree) {
    lines.push('  <project_structure>');
    lines.push('<![CDATA[');
    lines.push(tree);
    lines.push(']]>');
    lines.push('  </project_structure>');
  }

  lines.push('  <files>');

  for (const file of files) {
    const lang = file.lang ? ` lang="${file.lang}"` : '';
    lines.push(`    <file path="${escapeXmlAttr(file.relativePosix)}"${lang}>`);
    lines.push('<![CDATA[');
    let content;
    if (skeleton) {
      content = skeletonize(file.content, file.lang);
    } else if (minify) {
      content = minifyContent(file.content, file.lang);
    } else {
      content = file.content;
    }
    lines.push(content.replace(/]]>/g, ']]]]><![CDATA[>'));
    lines.push(']]>');
    lines.push('    </file>');
  }

  lines.push('  </files>');
  lines.push('</codebase>');

  return lines.join('\n');
}

function escapeXmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}