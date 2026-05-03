/**
 * collector.js
 * Walks the target directory, applies ignore rules, and reads file contents.
 */

import { readdir, readFile, stat, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import ignore from 'ignore';

// ── Default ignore patterns ───────────────────────────────────────────────────
// These are always excluded regardless of .gitignore.
const DEFAULT_IGNORE = [
  // Version control
  '.git', '.svn', '.hg',

  // Dependencies
  'node_modules', 'vendor', '.venv', 'venv', '__pycache__',
  'bower_components', 'jspm_packages',

  // Build output
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  'target', 'bin', 'obj',

  // Lock files (high token cost, low LLM value)
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Pipfile.lock', 'poetry.lock', 'Gemfile.lock',
  'composer.lock', 'cargo.lock',

  // IDE / OS
  '.DS_Store', 'Thumbs.db', '.idea', '.vscode',

  // Binary / media extensions
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp',
  '*.mp4', '*.mp3', '*.wav', '*.avi', '*.mov',
  '*.zip', '*.tar', '*.gz', '*.rar', '*.7z',
  '*.exe', '*.dll', '*.so', '*.dylib', '*.bin',
  '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.otf',
  '*.map',       // Source maps
  '*.min.js',    // Minified JS
  '*.min.css',   // Minified CSS
];

// File extensions we consider text (others skipped even if not ignored)
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

/**
 * Returns the language identifier for a file extension (used in Markdown code fences).
 */
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

/**
 * Build a tree string from an array of relative file paths.
 */
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
      // Directories (non-empty) first, then files
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

/**
 * Recursively collect all eligible files under `targetPath`.
 * Returns { files, tree, skipped }.
 */
export async function collectFiles(targetPath, options = {}) {
  const { include = [], exclude = [], maxFileSizeKB = 500 } = options;

  // Verify target exists
  try {
    await access(targetPath, fsConstants.R_OK);
  } catch {
    throw new Error(`Cannot access target path: ${targetPath}`);
  }

  const targetStat = await stat(targetPath);
  const isDirectory = targetStat.isDirectory();

  // Set up ignore rules
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  if (exclude.length) ig.add(exclude);

  // Load .gitignore if present
  if (isDirectory) {
    const gitignorePath = path.join(targetPath, '.gitignore');
    try {
      const gitignoreContent = await readFile(gitignorePath, 'utf8');
      ig.add(gitignoreContent);
    } catch {
      // No .gitignore — that's fine
    }
  }

  // Include filter (if specified, ONLY these patterns are allowed through)
  const includeIg = include.length ? ignore().add(include) : null;

  const maxBytes = maxFileSizeKB * 1024;
  const files = [];
  const skipped = [];

  async function walk(dirPath, relBase) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
      // Normalise to forward slashes for ignore matching (works on Windows too)
      const relPosix = relPath.split(path.sep).join('/');

      // Apply ignore rules
      if (ig.ignores(relPosix)) {
        skipped.push({ path: relPosix, reason: 'ignored' });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(path.join(dirPath, entry.name), relPath);
      } else if (entry.isFile()) {
        // Extension check
        const ext = path.extname(entry.name).toLowerCase();
        const baseName = entry.name.toLowerCase();

        // Allow files with no extension that look like dotfiles/configs
        const isLikelyText =
          TEXT_EXTENSIONS.has(ext) ||
          baseName.startsWith('.') ||
          !ext; // extensionless files (Makefile, Dockerfile, etc.)

        if (!isLikelyText) {
          skipped.push({ path: relPosix, reason: 'binary/non-text extension' });
          continue;
        }

        // Include filter
        if (includeIg && !includeIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'not in --include filter' });
          continue;
        }

        // Size check
        const fileStat = await stat(path.join(dirPath, entry.name));
        if (fileStat.size > maxBytes) {
          skipped.push({ path: relPosix, reason: `exceeds max size (${Math.round(fileStat.size / 1024)} KB)` });
          continue;
        }

        // Read content
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
    // ── Git fast-path ───────────────────────────────────────────────────
    // If the target is a git repo and git is available, use `git ls-files`
    // to get the exact set of tracked files (already respects .gitignore).
    // This is significantly faster than manual walking on large repos.
    let usedGit = false;

    try {
      // Confirm this is actually a git repo
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: targetPath,
        stdio: 'ignore',
      });

      // git ls-files: tracked + untracked-but-not-ignored files
      const output = execSync('git ls-files --cached --others --exclude-standard', {
        cwd: targetPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 50 * 1024 * 1024,  // 50 MB — large mono-repos
      }).toString();

      const gitPaths = output
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

      // Apply our default ignore list + user excludes on top of git's list
      const postIg = ignore().add(DEFAULT_IGNORE);
      if (exclude.length) postIg.add(exclude);

      for (const relPosix of gitPaths) {
        if (postIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'ignored' });
          continue;
        }

        // Include filter
        if (includeIg && !includeIg.ignores(relPosix)) {
          skipped.push({ path: relPosix, reason: 'not in --include filter' });
          continue;
        }

        const absPath = path.join(targetPath, relPosix);
        const relPath = relPosix.split('/').join(path.sep);

        // Extension / text check
        const ext = path.extname(relPosix).toLowerCase();
        const baseName = path.basename(relPosix).toLowerCase();
        const isLikelyText =
          TEXT_EXTENSIONS.has(ext) || baseName.startsWith('.') || !ext;

        if (!isLikelyText) {
          skipped.push({ path: relPosix, reason: 'binary/non-text extension' });
          continue;
        }

        // Size check
        let fileStat;
        try { fileStat = await stat(absPath); } catch { continue; }
        if (fileStat.size > maxBytes) {
          skipped.push({ path: relPosix, reason: `exceeds max size (${Math.round(fileStat.size / 1024)} KB)` });
          continue;
        }

        // Read content
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
    } catch {
      // git not available, not a repo, or any other error → fall through to manual walk
    }

    if (!usedGit) {
      await walk(targetPath, '');
    }
  } else { // single-file target
    // Single file target
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

  // Sort files: by directory depth, then alphabetically
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
