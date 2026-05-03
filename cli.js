#!/usr/bin/env node

/**
 * ai-context-packer CLI
 * Entry point — wires together all modules and handles top-level UX.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { execSync } from 'child_process';
import { collectFiles } from './collector.js';
import { buildMarkdown, buildXML } from './formatter.js';
import { countTokens } from './tokenCounter.js';
import { scanSecrets } from './secretScanner.js';
import { printBanner, printSummary } from './ui.js';
import prompts from 'prompts';

// ── GitHub URL helpers ────────────────────────────────────────────────────────

/** Return true if the target looks like a GitHub (or any git) URL. */
function isGitUrl(target) {
  return /^https?:\/\//i.test(target) || /^git@/i.test(target);
}

/**
 * Clone `url` into a fresh temp directory using `git clone --depth 1`.
 * Returns the path to the cloned repo root.
 * Throws a descriptive Error if git is missing or the clone fails.
 */
async function cloneRepo(url) {
  // Verify git is available
  try {
    execSync('git --version', { stdio: 'ignore' });
  } catch {
    throw new Error('git is not installed or not on PATH. Cannot clone remote URL.');
  }

  const tmpBase = path.join(os.tmpdir(), 'ai-context-packer-');
  const tmpDir  = await mkdtemp(tmpBase);

  console.log(chalk.dim(`  Cloning ${url} …`));
  try {
    execSync(`git clone --depth 1 --quiet "${url}" "${tmpDir}"`, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    // Clean up on failure so we don't leak temp dirs
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`git clone failed: ${err.stderr?.toString().trim() || err.message}`);
  }

  console.log(chalk.green('  ✔  Clone complete'));
  return tmpDir;
}

const program = new Command();

program
  .name('ai-context-packer')
  .description('📦 Package your codebase into a single LLM-optimized context file')
  .version('1.0.0')
  .argument('[target]', 'Directory or file(s) to pack', '.')
  .option('-f, --format <format>', 'Output format: markdown or xml', 'markdown')
  .option('-o, --output <file>', 'Write output to a file instead of clipboard')
  .option('--no-tree', 'Omit the directory tree from output')
  .option('--no-clipboard', 'Skip copying to clipboard')
  .option('--include <globs>', 'Comma-separated glob patterns to force-include (e.g. "*.md,*.json")')
  .option('--exclude <globs>', 'Comma-separated glob patterns to force-exclude (e.g. "*.test.js")')
  .option('--max-file-size <kb>', 'Skip files larger than this size in KB (default: 500)', '500')
  .option('--no-secrets-scan', 'Disable secret/sensitive-data scanning')
  .option('--minify', 'Strip comments and blank lines to reduce token count')
  .action(async (target, options) => {
    printBanner();

    const format = options.format.toLowerCase();

    if (!['markdown', 'xml'].includes(format)) {
      console.error(chalk.red(`✖  Unknown format "${format}". Use "markdown" or "xml".`));
      process.exit(1);
    }

    // ── 0. GitHub / remote URL handling ──────────────────────────────────
    let tmpDir = null;   // set when we clone so we can clean up later
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
    console.log('');

    // ── 1. Collect files ──────────────────────────────────────────────────
    let collected;
    try {
      collected = await collectFiles(resolvedTarget, {
        include: options.include ? options.include.split(',') : [],
        exclude: options.exclude ? options.exclude.split(',') : [],
        maxFileSizeKB: parseInt(options.maxFileSize, 10),
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

    // ── 2. Secret scanning ────────────────────────────────────────────────
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

    // ── 3. Format output ──────────────────────────────────────────────────
    const formatOpts = { includeTree: options.tree !== false, minify: !!options.minify };
    const output =
      format === 'xml'
        ? buildXML(collected, formatOpts)
        : buildMarkdown(collected, formatOpts);

    // ── 4. Token count ────────────────────────────────────────────────────
    const tokens = countTokens(output);

    // ── 5. Write / copy output ────────────────────────────────────────────
    if (options.output) {
      const outPath = path.resolve(process.cwd(), options.output);
      await writeFile(outPath, output, 'utf8');
      console.log(chalk.green(`  ✔  Output written to ${outPath}`));
    } else if (options.clipboard !== false) {
      try {
        // Dynamic import so the tool still works if clipboard is unavailable
        const { default: clipboardy } = await import('clipboardy');
        await clipboardy.write(output);
        console.log(chalk.green('  ✔  Output copied to clipboard!'));
      } catch {
        console.warn(chalk.yellow('  ⚠  Clipboard unavailable. Use --output <file> to save instead.'));
      }
    }

    // ── 6. Summary ────────────────────────────────────────────────────────
    printSummary({ collected, tokens, format });

    // ── 7. Cleanup temp clone dir ─────────────────────────────────────────
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      console.log(chalk.dim('  Temp clone directory removed.\n'));
    }
  });

program.parse();
