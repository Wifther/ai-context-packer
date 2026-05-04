/**
 * ui.js
 * Console banner, progress messages, and final summary output.
 */

import chalk from 'chalk';
import { formatTokenCount } from './tokenCounter.js';

/** ASCII banner printed on startup. */
export function printBanner() {
  console.log('');
  console.log(
    chalk.cyan.bold('  ╔══════════════════════════════════════╗')
  );
  console.log(
    chalk.cyan.bold('  ║') +
    chalk.white.bold('   📦 ai-context-packer  v1.0.1        ') +
    chalk.cyan.bold('║')
  );
  console.log(
    chalk.cyan.bold('  ║') +
    chalk.dim('   Package your codebase for LLMs      ') +
    chalk.cyan.bold('║')
  );
  console.log(
    chalk.cyan.bold('  ╚══════════════════════════════════════╝')
  );
  console.log('');
}

/**
 * Print a final summary table after all processing is complete.
 *
 * @param {{ collected, tokens: number, format: string }} params
 */
export function printSummary({ collected, tokens, format }) {
  const { files, skipped } = collected;
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const { formatted, fits, doesNotFit, status } = formatTokenCount(tokens);

  const tokenColor =
    status === 'ok' ? chalk.green :
    status === 'warn' ? chalk.yellow :
    chalk.red;

  console.log('');
  console.log(chalk.bold('  ── Summary ───────────────────────────────────'));
  console.log(`  ${chalk.dim('Format        ')}  ${format.toUpperCase()}`);
  console.log(`  ${chalk.dim('Files packed  ')}  ${chalk.green(files.length)}`);
  console.log(`  ${chalk.dim('Files skipped ')}  ${chalk.dim(skipped.length)}`);
  console.log(`  ${chalk.dim('Total size    ')}  ${formatBytes(totalBytes)}`);
  console.log(`  ${chalk.dim('Est. tokens   ')}  ${tokenColor.bold('~' + formatted)}`);

  // Context window fit indicators
  if (fits.length) {
    console.log(`  ${chalk.dim('Fits in       ')}  ${chalk.green(fits.join(', '))}`);
  }
  if (doesNotFit.length) {
    console.log(`  ${chalk.dim('Exceeds       ')}  ${chalk.red(doesNotFit.join(', '))}`);
  }

  if (status === 'warn') {
    console.log('');
    console.log(
      chalk.yellow('  ⚠  Token count exceeds GPT-5.5 Pro limit. Consider using --exclude to trim files.')
    );
  } else if (status === 'error') {
    console.log('');
    console.log(
      chalk.red('  ✖  Token count is very large. Even Gemini 3.1 Pro (2M) context may not fit!')
    );
  }

  console.log(chalk.bold('  ──────────────────────────────────────────────'));
  console.log('');
}

/** Human-readable byte size string. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
