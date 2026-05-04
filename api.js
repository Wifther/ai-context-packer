import chalk from 'chalk';

function startSpinner(label = 'Thinking') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i % frames.length])}  ${chalk.dim(label + '...')} `);
    i++;
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
  };
}

async function fetchWithTimeout(url, opts, timeoutMs = 120_000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out after 120 seconds.');
    throw err;
  } finally {
    clearTimeout(tid);
  }
}

async function askOpenAI(systemContext, query, apiKey) {
  const stopSpinner = startSpinner('Waiting for OpenAI');
  let res;
  try {
    res = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          stream: false,
          messages: [
            { role: 'system', content: systemContext },
            { role: 'user', content: query },
          ],
        }),
      }
    );
  } finally {
    stopSpinner();
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    const msg = (() => {
      try {
        const j = JSON.parse(body);
        return j?.error?.message || body;
      } catch { return body; }
    })();

    if (res.status === 400 && /context length|maximum context/i.test(msg)) {
      throw new Error(`OpenAI context-length exceeded. Use --chunk to split the payload.\n  Detail: ${msg}`);
    }
    if (res.status === 401) throw new Error('OpenAI: Invalid API key. Check your OPENAI_API_KEY.');
    if (res.status === 429) throw new Error('OpenAI: Rate limit hit. Wait a moment and retry.');
    throw new Error(`OpenAI API error ${res.status}: ${msg}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty response.');
  return text;
}

async function askAnthropic(systemContext, query, apiKey) {
  const stopSpinner = startSpinner('Waiting for Anthropic');
  let res;
  try {
    res = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 4096,
          system: systemContext,
          messages: [
            { role: 'user', content: query },
          ],
        }),
      }
    );
  } finally {
    stopSpinner();
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    const msg = (() => {
      try {
        const j = JSON.parse(body);
        return j?.error?.message || body;
      } catch { return body; }
    })();

    if (res.status === 400 && /too large|context window|prompt is too long/i.test(msg)) {
      throw new Error(`Anthropic context-length exceeded. Use --chunk to split the payload.\n  Detail: ${msg}`);
    }
    if (res.status === 401) throw new Error('Anthropic: Invalid API key. Check your ANTHROPIC_API_KEY.');
    if (res.status === 429) throw new Error('Anthropic: Rate limit hit. Wait a moment and retry.');
    throw new Error(`Anthropic API error ${res.status}: ${msg}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Anthropic returned an empty response.');
  return text;
}

export async function askAI(systemContext, query) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!anthropicKey && !openaiKey) {
    throw new Error(
      'No API key found.\n' +
      '  Export one of the following before using --ask:\n' +
      '    export ANTHROPIC_API_KEY=your_key_here\n' +
      '    export OPENAI_API_KEY=your_key_here'
    );
  }

  if (anthropicKey) {
    console.log(chalk.dim('  Provider : Anthropic (claude-opus-4-5)\n'));
    return { provider: 'Anthropic', text: await askAnthropic(systemContext, query, anthropicKey) };
  }

  console.log(chalk.dim('  Provider : OpenAI (gpt-4o)\n'));
  return { provider: 'OpenAI', text: await askOpenAI(systemContext, query, openaiKey) };
}
