import chalk from 'chalk';
import path from 'path';
import { formatTokenCount } from './tokenCounter.js';

export function printBanner() {
  console.log('');
  console.log(chalk.cyan.bold('  ╔══════════════════════════════════════╗'));
  console.log(
    chalk.cyan.bold('  ║') +
    chalk.white.bold('   📦 ai-context-packer  v2.0.0        ') +
    chalk.cyan.bold('║')
  );
  console.log(
    chalk.cyan.bold('  ║') +
    chalk.dim('   Package your codebase for LLMs      ') +
    chalk.cyan.bold('║')
  );
  console.log(chalk.cyan.bold('  ╚══════════════════════════════════════╝'));
  console.log('');
}

export function printSummary({ collected, tokens, format, splitFiles = null }) {
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

  if (fits.length) {
    console.log(`  ${chalk.dim('Fits in       ')}  ${chalk.green(fits.join(', '))}`);
  }
  if (doesNotFit.length) {
    console.log(`  ${chalk.dim('Exceeds       ')}  ${chalk.red(doesNotFit.join(', '))}`);
  }

  if (splitFiles && splitFiles.length > 1) {
    console.log('');
    console.log(`  ${chalk.dim('Split into    ')}  ${chalk.yellow.bold(splitFiles.length + ' chunks')}`);
    for (const sf of splitFiles) {
      const name = path.basename(sf.path);
      console.log(`  ${chalk.dim('  →')}  ${chalk.white(name)}  ${chalk.dim(`(~${sf.tokens.toLocaleString()} tokens, ${sf.files} files)`)}`);
    }
  }

  if (status === 'warn' && !splitFiles) {
    console.log('');
    console.log(chalk.yellow('  ⚠  Token count exceeds 1M limit for GPT-5.5 / Claude 4.7. Try --chunk 1000000 to auto-split.'));
  } else if (status === 'error' && !splitFiles) {
    console.log('');
    console.log(chalk.red('  ✖  Token count is massive. Even Gemini 3.1 Pro (1,048,576) may not fit. Use --chunk to split.'));
  }

  console.log(chalk.bold('  ──────────────────────────────────────────────'));
  console.log('');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}