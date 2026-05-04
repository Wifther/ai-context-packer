export function countTokens(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const charBased = Math.ceil(text.length / 4);
  return Math.max(words, charBased);
}

export function formatTokenCount(tokens) {
  const formatted = tokens.toLocaleString();

  const limits = {
    'GPT-5.5 Pro (1M)': 1_000_000,
    'Claude Opus 4.7 (1M)': 1_000_000,
    'Gemini 3.1 Pro (1M)': 1_048_576,
  };

  const fits = Object.entries(limits)
    .filter(([, limit]) => tokens <= limit)
    .map(([name]) => name);

  const doesNotFit = Object.entries(limits)
    .filter(([, limit]) => tokens > limit)
    .map(([name]) => name);

  let status = 'ok';
  if (tokens > 1_048_576) status = 'error';
  else if (tokens > 1_000_000) status = 'warn';

  return { formatted, fits, doesNotFit, status };
}

export function chunkFiles(files, buildFn, formatOpts, tokenLimit) {
  const batches = [];
  let currentBatch = [];

  for (const file of files) {
    const candidate = [...currentBatch, file];
    const preview = buildFn({ files: candidate, tree: '' }, { ...formatOpts, includeTree: false });
    const tokens = countTokens(preview);

    if (tokens > tokenLimit && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [file];
    } else {
      currentBatch = candidate;
    }
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}