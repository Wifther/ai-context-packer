Markdown

# 📦 ai-context-packer

> Package your codebase into a single, LLM-optimized context file — instantly.

`ai-context-packer` walks a directory (or file list), filters out noise, and produces one clean Markdown or XML document you can paste directly into Claude, GPT-4, Gemini, or any other LLM. 

**🔥 v2.0.0 Update:** Now features Interactive TUI, Git-Diff packing, Skeleton mode, Auto-splitting, and Direct Ask API!

---

## ✨ Features

| Feature | Details |
|---|---|
| **Intelligent ignoring** | Auto-ignores `node_modules`, `.git`, binaries, lock files. Respects `.gitignore`. |
| **🧠 Direct Ask API** | Send your codebase context and a prompt directly to OpenAI/Anthropic APIs from the terminal. |
| **🎛️ Interactive UI** | Use `-i` to visually select exactly which folders and files to pack. |
| **🐙 Git-Diff Packing** | Use `--changed` to only pack files you've modified or added. |
| **🦴 Skeleton Mode** | Strip function implementations but keep signatures/classes to pack massive repos. |
| **🪓 Auto-Splitting** | Set a token limit and automatically chunk the output into multiple files. |
| **Secret scanner** | Detects `.env` files, API keys, private keys, connection strings — prompts before including them. |

---

## 🚀 Quick Start

### Run without installing (npx)

```bash
npx ai-context-packer .
Install globally
Bash

npm install -g ai-context-packer
ai-context-packer .
📖 Usage
ai-context-packer [target] [options]
Arguments
Argument	Description	Default
target	Directory or file path to pack	. (current dir)

Options
Flag	Description	Default
-i, --interactive	Interactively select files and folders to include	—
--changed	Only pack files modified, staged, or untracked in git	—
--skeleton	Strip function bodies, keep signatures only (saves massive tokens)	—
--chunk <limit>	Split output into multiple files if tokens exceed this limit	—
--ask <query>	Send the packed codebase + your query directly to an AI API	—
--minify	Strip comments and blank lines to save LLM tokens	—
-f, --format <format>	Output format: markdown or xml	markdown
-o, --output <file>	Write output to a file (instead of clipboard)	—
--no-tree	Omit the directory tree	—
--no-clipboard	Skip clipboard copy	—
--include <globs>	Only include matching files (comma-separated)	—
--exclude <globs>	Force-exclude matching files (comma-separated)	—
--max-file-size <kb>	Skip files larger than N KB	500
--no-secrets-scan	Disable secret scanning	—
-V, --version	Print version	—

🔥 Advanced Examples (v2.0)
Bash

# Ask AI directly (requires OPENAI_API_KEY or ANTHROPIC_API_KEY exported in env)
ai-context-packer . --ask "Find security vulnerabilities in this code"

# Visual selection: choose exactly what to pack
ai-context-packer . -i

# Only pack files you've modified in Git
ai-context-packer . --changed

# Pack a huge repo by only keeping class/function signatures
ai-context-packer . --skeleton

# Auto-split the output into multiple files if it exceeds 500k tokens
ai-context-packer . --chunk 500000
Basic Examples
Bash

# Pack current directory → clipboard (Markdown)
ai-context-packer .

# Only include TypeScript and Markdown files
ai-context-packer . --include "*.ts,*.md"

# Pack a remote GitHub repository directly
ai-context-packer https://github.com/user/repo
🔐 Secret Scanning
If a secret is detected you'll see:

  🔐 SECRETS DETECTED IN PAYLOAD  
────────────────────────────────────────────────────────────
  ⚠  .env
       .env file
  ⚠  src/config.js
       API key or secret assignment
────────────────────────────────────────────────────────────
  Sending secrets to an LLM poses a serious privacy risk!

? Continue anyway and include these files? › (y/N)
Answering N aborts with no output written. You can suppress this check entirely with --no-secrets-scan.

📊 Token Counter
After packing, you'll see a summary like:

── Summary ───────────────────────────────────
  Format          MARKDOWN
  Files packed    42
  Files skipped   118
  Total size      184.3 KB
  Est. tokens     ~47,200
  Fits in         GPT-5.5 Pro (1M), Claude Opus 4.7 (1M), Gemini 3.1 Pro (1M)
──────────────────────────────────────────────
Tokens are estimated using the fast heuristic max(wordCount, charCount / 4), which is within ~5% of cl100k_base for typical code.

🛠️ Architecture
src/
├── api.js           OpenAI / Anthropic direct fetch client
├── cli.js           Main entry point & command wiring
├── collector.js     Directory walker, ignore rules, file reader
├── formatter.js     Markdown & XML output builders, skeletonizer
├── tokenCounter.js  Fast heuristic token estimator & chunking logic
├── secretScanner.js Regex-based secret/credential detection
└── ui.js            Banner, summary, chalk colours
License
MIT