#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import { writeFile, rm, mkdtemp, readdir, stat } from 'fs/promises';
import { execSync } from 'child_process';
import { collectFiles } from './collector.js';
import { buildMarkdown, buildXML } from './formatter.js';
import { countTokens, chunkFiles } from './tokenCounter.js';
import { scanSecrets } from './secretScanner.js';
import { printBanner, printSummary } from './ui.js';
import { askAI } from './api.js';
import prompts from 'prompts';

function isGitUrl(target) {
  return /^https?:\/\//i.test(target) || /^git@/i.test(target);
}

async function cloneRepo(url) {
  try {
    execSync('git --version', { stdio: 'ignore' });
  } catch {
    throw new Error('git is not installed or not on PATH. Cannot clone remote URL.');
  }

  const tmpBase = path.join(os.tmpdir(), 'ai-context-packer-');
  const tmpDir = await mkdtemp(tmpBase);

  console.log(chalk.dim(`  Cloning ${url} …`));
  try {
    execSync(`git clone --depth 1 --quiet "${url}" "${tmpDir}"`, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`git clone failed: ${err.stderr?.toString().trim() || err.message}`);
  }

  console.log(chalk.green('  ✔  Clone complete'));
  return tmpDir;
}

async function getInteractiveChoices(targetPath, maxDepth = 2) {
  const choices = [];

  async function walk(dir, rel, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        const isDir = entry.isDirectory();
        choices.push({
          title: (rel ? '  '.repeat(depth - 1) : '') + entry.name + (isDir ? '/' : ''),
          value: relPath + (isDir ? '/' : ''),
          selected: true,
        });
        if (isDir && depth < maxDepth) {
          await walk(path.join(dir, entry.name), relPath, depth + 1);
        }
      }
    } catch {}
  }

  await walk(targetPath, '', 1);
  return choices;
}

const program = new Command();

program
  .name('ai-context-packer')
  .description('Package your codebase into a single LLM-optimized context file')
  .version('2.0.0')
  .argument('[target]', 'Directory or file(s) to pack', '.')
  .option('-i, --interactive', 'Interactively select files and folders to include')
  .option('--changed', 'Only pack files modified, staged, or untracked in git')
  .option('--skeleton', 'Strip function bodies, keep signatures only')
  .option('-f, --format <format>', 'Output format: markdown or xml', 'markdown')
  .option('-o, --output <file>', 'Write output to a file instead of clipboard')
  .option('--no-tree', 'Omit the directory tree from output')
  .option('--no-clipboard', 'Skip copying to clipboard')
  .option('--include <globs>', 'Comma-separated glob patterns to force-include')
  .option('--exclude <globs>', 'Comma-separated glob patterns to force-exclude')
  .option('--max-file-size <kb>', 'Skip files larger than this size in KB', '500')
  .option('--no-secrets-scan', 'Disable secret/sensitive-data scanning')
  .option('--minify', 'Strip comments and blank lines to reduce token count')
  .option('--chunk <limit>', 'Split output into multiple files if tokens exceed this limit')
  .option('--ask <query>', 'Send the packed codebase + your query directly to an AI API')
  .action(async (target, options) => {
    printBanner();

    const format = options.format.toLowerCase();

    if (!['markdown', 'xml'].includes(format)) {
      console.error(chalk.red(`✖  Unknown format "${format}". Use "markdown" or "xml".`));
      process.exit(1);
    }

    const chunkLimit = options.chunk ? parseInt(options.chunk, 10) : null;
    if (options.chunk && (isNaN(chunkLimit) || chunkLimit < 1)) {
      console.error(chalk.red('✖  --chunk must be a positive integer (e.g., --chunk 500000).'));
      process.exit(1);
    }

    let tmpDir = null;
    let resolvedTarget;

    if (isGitUrl(target)) {
      try {
        tmpDir = await cloneRepo(target);
        resolvedTarget = tmpDir;
      } catch (err) {
        console.error(chalk.red(`\n✖  ${err.message}`));
        process.exit(1);
      }
    } else {
      resolvedTarget = path.resolve(process.cwd(), target);
    }

    console.log(chalk.dim(`  Target  : ${target}`));
    console.log(chalk.dim(`  Format  : ${format}`));
    if (options.minify) console.log(chalk.dim('  Minify  : on'));
    if (options.skeleton) console.log(chalk.dim('  Skeleton: on'));
    if (options.changed) console.log(chalk.dim('  Changed : on'));
    if (chunkLimit) console.log(chalk.dim(`  Chunk   : ${chunkLimit.toLocaleString()} tokens`));
    if (options.ask) console.log(chalk.dim(`  Ask     : ${options.ask}`));
    console.log('');

    let includePatterns = options.include ? options.include.split(',') : [];

    if (options.interactive) {
      try {
        const targetStat = await stat(resolvedTarget);
        if (targetStat.isDirectory()) {
          const choices = await getInteractiveChoices(resolvedTarget, 2);
          if (choices.length === 0) {
            console.warn(chalk.yellow('⚠  No items found for interactive selection.'));
            process.exit(0);
          }
          const response = await prompts({
            type: 'multiselect',
            name: 'selected',
            message: 'Select files and folders to include',
            choices,
            instructions: false,
            hint: 'Space to toggle, Enter to confirm',
          });
          if (!response.selected || response.selected.length === 0) {
            console.log(chalk.dim('\n  Aborted. No items selected.\n'));
            process.exit(0);
          }
          const dynamicPatterns = response.selected.map(s => s.endsWith('/') ? s + '**' : s);
          includePatterns = [...includePatterns, ...dynamicPatterns];
        }
      } catch (err) {
        console.error(chalk.red(`\n✖  Interactive mode failed: ${err.message}`));
        process.exit(1);
      }
    }

    let collected;
    try {
      collected = await collectFiles(resolvedTarget, {
        include: includePatterns,
        exclude: options.exclude ? options.exclude.split(',') : [],
        maxFileSizeKB: parseInt(options.maxFileSize, 10),
        changed: options.changed,
      });
    } catch (err) {
      console.error(chalk.red(`\n✖  Failed to collect files:\n   ${err.message}`));
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      process.exit(1);
    }

    if (collected.files.length === 0) {
      console.warn(chalk.yellow('⚠  No files matched. Check your target path or include/exclude filters.'));
      process.exit(0);
    }

    if (options.secretsScan !== false) {
      const warnings = scanSecrets(collected.files);

      if (warnings.length > 0) {
        console.log(chalk.bgRed.white.bold('\n  🔐 SECRETS DETECTED IN PAYLOAD  '));
        console.log(chalk.red('─'.repeat(60)));
        for (const w of warnings) {
          console.log(chalk.red(`  ⚠  ${w.file}`));
          console.log(chalk.dim(`       ${w.reason}`));
        }
        console.log(chalk.red('─'.repeat(60)));
        console.log(chalk.yellow('  Sending secrets to an LLM poses a serious privacy risk!\n'));

        const { proceed } = await prompts({
          type: 'confirm',
          name: 'proceed',
          message: 'Continue anyway and include these files?',
          initial: false,
        });

        if (!proceed) {
          console.log(chalk.dim('\n  Aborted. Consider adding sensitive files to .gitignore.\n'));
          process.exit(0);
        }

        console.log('');
      }
    }

    const buildFn = format === 'xml' ? buildXML : buildMarkdown;
    const formatOpts = {
      includeTree: options.tree !== false,
      minify: !!options.minify,
      skeleton: !!options.skeleton,
    };

    if (options.ask) {
      const fullOutput = buildFn(collected, formatOpts);
      const tokens = countTokens(fullOutput);

      console.log(chalk.dim(`  Est. tokens in context: ~${tokens.toLocaleString()}\n`));

      try {
        const { provider, text } = await askAI(fullOutput, options.ask);
        console.log(chalk.cyan.bold(`\n  ── Response from ${provider} ${'─'.repeat(Math.max(0, 40 - provider.length))}`));
        console.log('');
        console.log(text);
        console.log('');
        console.log(chalk.cyan.bold('  ' + '─'.repeat(44)));
        console.log('');
      } catch (err) {
        console.error(chalk.red(`\n✖  ${err.message}\n`));
        if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        process.exit(1);
      }

      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        console.log(chalk.dim('  Temp clone directory removed.\n'));
      }
      return;
    }

    if (chunkLimit) {
      const batches = chunkFiles(collected.files, buildFn, formatOpts, chunkLimit);
      const totalTokens = countTokens(buildFn(collected, formatOpts));

      if (batches.length === 1) {
        console.log(chalk.dim('  ℹ  Token count fits within chunk limit — single file output.\n'));
      } else {
        console.log(chalk.yellow(`  ⚡  Splitting into ${batches.length} chunks (limit: ${chunkLimit.toLocaleString()} tokens)\n`));
      }

      const ext = format === 'xml' ? 'xml' : 'md';
      const baseName = options.output
        ? options.output.replace(/\.[^.]+$/, '')
        : 'output';

      const writtenFiles = [];

      for (let idx = 0; idx < batches.length; idx++) {
        const batchCollected = {
          ...collected,
          files: batches[idx],
        };
        const batchOutput = buildFn(batchCollected, formatOpts);
        const suffix = batches.length > 1 ? `_part${idx + 1}` : '';
        const fileName = `${baseName}${suffix}.${ext}`;
        const outPath = path.resolve(process.cwd(), fileName);
        await writeFile(outPath, batchOutput, 'utf8');
        const batchTokens = countTokens(batchOutput);
        writtenFiles.push({ path: outPath, tokens: batchTokens, files: batches[idx].length });
        console.log(chalk.green(`  ✔  Part ${idx + 1}/${batches.length} → ${fileName}`) + chalk.dim(` (~${batchTokens.toLocaleString()} tokens, ${batches[idx].length} files)`));
      }

      console.log('');
      printSummary({ collected, tokens: totalTokens, format, splitFiles: writtenFiles });

      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        console.log(chalk.dim('  Temp clone directory removed.\n'));
      }
      return;
    }

    const output = buildFn(collected, formatOpts);
    const tokens = countTokens(output);

    if (options.output) {
      const outPath = path.resolve(process.cwd(), options.output);
      await writeFile(outPath, output, 'utf8');
      console.log(chalk.green(`  ✔  Output written to ${outPath}`));
    } else if (options.clipboard !== false) {
      try {
        const { default: clipboardy } = await import('clipboardy');
        await clipboardy.write(output);
        console.log(chalk.green('  ✔  Output copied to clipboard!'));
      } catch {
        console.warn(chalk.yellow('  ⚠  Clipboard unavailable. Use --output <file> to save instead.'));
      }
    }

    printSummary({ collected, tokens, format });

    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      console.log(chalk.dim('  Temp clone directory removed.\n'));
    }
  });

program.parse();