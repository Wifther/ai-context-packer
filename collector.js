import { readdir, readFile, stat, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import ignore from 'ignore';

const DEFAULT_IGNORE = [
  '.git', '.svn', '.hg',
  'node_modules', 'vendor', '.venv', 'venv', '__pycache__',
  'bower_components', 'jspm_packages',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  'target', 'bin', 'obj',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Pipfile.lock', 'poetry.lock', 'Gemfile.lock',
  'composer.lock', 'cargo.lock',
  '.DS_Store', 'Thumbs.db', '.idea', '.vscode',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp',
  '*.mp4', '*.mp3', '*.wav', '*.avi', '*.mov',
  '*.zip', '*.tar', '*.gz', '*.rar', '*.7z',
  '*.exe', '*.dll', '*.so', '*.dylib', '*.bin',
  '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.otf',
  '*.map',
  '*.min.js',
  '*.min.css',
];

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.kt', '.kts',
  '.go', '.rs', '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs', '.swift', '.scala', '.clj', '.hs', '.ex', '.exs',
  '.html', '.htm', '.xml', '.xhtml',
  '.css', '.scss', '.sass', '.less',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini',
  '.env', '.env.example', '.env.local',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro',
  '.tf', '.hcl', '.dockerfile', '.dockerignore',
  '.gitignore', '.gitattributes', '.editorconfig',
  '.eslintrc', '.prettierrc', '.babelrc',
  '.nvmrc', '.npmrc',
]);

export function langFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.rb': 'ruby', '.php': 'php',
    '.java': 'java', '.kt': 'kotlin', '.go': 'go',
    '.rs': 'rust', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.cs': 'csharp', '.swift': 'swift', '.scala': 'scala',
    '.html': 'html', '.htm': 'html', '.css': 'css',
    '.scss': 'scss', '.sass': 'sass', '.less': 'less',
    '.json': 'json', '.jsonc': 'json',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.md': 'markdown', '.mdx': 'mdx', '.sql': 'sql',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.graphql': 'graphql', '.gql': 'graphql',
    '.vue': 'vue', '.svelte': 'svelte',
    '.tf': 'hcl', '.hcl': 'hcl',
    '.xml': 'xml', '.xhtml': 'xml',
  };
  return map[ext] || '';
}

export function buildTree(relativePaths, rootLabel = '.') {
  const tree = {};

  for (const p of relativePaths) {
    const parts = p.split(path.sep);
    let node = tree;
    for (const part of parts) {
      node[part] = node[part] || {};
      node = node[part];
    }
  }

  const lines = [rootLabel];

  function render(node, prefix = '') {
    const entries = Object.keys(node).sort((a, b) => {
      const aIsDir = Object.keys(node[a]).length > 0;
      const bIsDir = Object.keys(node[b]).length > 0;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    entries.forEach((entry, idx) => {
      const isLast = idx === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${entry}`);
      const children = node[entry];
      if (Object.keys(children).length > 0) {
        render(children, prefix + (isLast ? '    ' : '│   '));
      }
    });
  }

  render(tree);
  return lines.join('\n');
}

export async function collectFiles(targetPath, options = {}) {
  const { include = [], exclude = [], maxFileSizeKB = 500, changed = false } = options;

  try {
    await access(targetPath, fsConstants.R_OK);
  } catch {
    throw new Error(`Cannot access target path: ${targetPath}`);
  }

  const targetStat = await stat(targetPath);
  const isDirectory = targetStat.isDirectory();

  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  if (exclude.length) ig.add(exclude);

  if (isDirectory) {
    const gitignorePath = path.join(targetPath, '.gitignore');
    try {
      const gitignoreContent = await readFile(gitignorePath, 'utf8');
      ig.add(gitignoreContent);
    } catch {}
  }

  const includeIg = include.length ? ignore().add(include) : null;

  const maxBytes = maxFileSizeKB * 1024;
  const files = [];
  const skipped = [];

  async function walk(dirPath, relBase) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
      const relPosix = relPath.split(path.sep).join('/');

      if (ig.ignores(relPosix)) {
        skipped.push({ path: relPosix, reason: 'ignored' });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(path.join(dirPath, entry.name), relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const baseName = entry.name.toLowerCase();

        const isLikelyText =
          TEXT_EXTENSIONS.has(ext) ||
          baseName.startsWith('.') ||
          !ext;

        if (!isLikelyText) {
          skipped.push({ path: relPosix, reason: 'binary/non-text extension' });
          continue;
        }

        if (includeIg && !includeIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'not in --include filter' });
          continue;
        }

        const fileStat = await stat(path.join(dirPath, entry.name));
        if (fileStat.size > maxBytes) {
          skipped.push({ path: relPosix, reason: `exceeds max size (${Math.round(fileStat.size / 1024)} KB)` });
          continue;
        }

        try {
          const content = await readFile(path.join(dirPath, entry.name), 'utf8');
          files.push({
            relativePath: relPath,
            relativePosix: relPosix,
            absolutePath: path.join(dirPath, entry.name),
            content,
            sizeBytes: fileStat.size,
            lang: langFromExt(entry.name),
          });
        } catch {
          skipped.push({ path: relPosix, reason: 'read error (possibly binary)' });
        }
      }
    }
  }

  if (isDirectory) {
    let usedGit = false;

    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: targetPath,
        stdio: 'ignore',
      });

      let gitPaths;
      if (changed) {
        let modified = [];
        try {
          modified = execSync('git diff --name-only HEAD', {
            cwd: targetPath,
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 50 * 1024 * 1024,
          }).toString().split('\n').map(l => l.trim()).filter(Boolean);
        } catch {}
        let untracked = [];
        try {
          untracked = execSync('git ls-files --others --exclude-standard', {
            cwd: targetPath,
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 50 * 1024 * 1024,
          }).toString().split('\n').map(l => l.trim()).filter(Boolean);
        } catch {}
        gitPaths = [...new Set([...modified, ...untracked])];
      } else {
        const output = execSync('git ls-files --cached --others --exclude-standard', {
          cwd: targetPath,
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 50 * 1024 * 1024,
        }).toString();

        gitPaths = output
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);
      }

      const postIg = ignore().add(DEFAULT_IGNORE);
      if (exclude.length) postIg.add(exclude);

      for (const relPosix of gitPaths) {
        if (postIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'ignored' });
          continue;
        }

        if (includeIg && !includeIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'not in --include filter' });
          continue;
        }

        const absPath = path.join(targetPath, relPosix);
        const relPath = relPosix.split('/').join(path.sep);

        const ext = path.extname(relPosix).toLowerCase();
        const baseName = path.basename(relPosix).toLowerCase();
        const isLikelyText =
          TEXT_EXTENSIONS.has(ext) || baseName.startsWith('.') || !ext;

        if (!isLikelyText) {
          skipped.push({ path: relPosix, reason: 'binary/non-text extension' });
          continue;
        }

        let fileStat;
        try { fileStat = await stat(absPath); } catch { continue; }
        if (fileStat.size > maxBytes) {
          skipped.push({ path: relPosix, reason: `exceeds max size (${Math.round(fileStat.size / 1024)} KB)` });
          continue;
        }

        try {
          const content = await readFile(absPath, 'utf8');
          files.push({
            relativePath: relPath,
            relativePosix: relPosix,
            absolutePath: absPath,
            content,
            sizeBytes: fileStat.size,
            lang: langFromExt(relPosix),
          });
        } catch {
          skipped.push({ path: relPosix, reason: 'read error (possibly binary)' });
        }
      }

      usedGit = true;
    } catch {}

    if (!usedGit) {
      await walk(targetPath, '');
    }
  } else {
    const fileStat = await stat(targetPath);
    const content = await readFile(targetPath, 'utf8');
    files.push({
      relativePath: path.basename(targetPath),
      relativePosix: path.basename(targetPath),
      absolutePath: targetPath,
      content,
      sizeBytes: fileStat.size,
      lang: langFromExt(targetPath),
    });
  }

  files.sort((a, b) => {
    const depthA = a.relativePosix.split('/').length;
    const depthB = b.relativePosix.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.relativePosix.localeCompare(b.relativePosix);
  });

  const tree = buildTree(
    files.map(f => f.relativePath),
    path.basename(targetPath) || '.'
  );

  return { files, tree, skipped, rootPath: targetPath };
}