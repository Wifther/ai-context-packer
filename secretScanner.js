/**
 * secretScanner.js
 *
 * Scans collected file content for common secret / credential patterns.
 * Returns a list of warning objects for any suspicious findings.
 */

/**
 * Patterns that indicate a file might contain sensitive data.
 * Each entry: { name, regex }
 *
 * Patterns are intentionally broad to minimise false negatives —
 * the user can always choose to continue after the warning.
 */
const SECRET_PATTERNS = [
  // Dotenv files
  {
    name: '.env file',
    filePattern: /^\.env(\..+)?$/,   // matches filename, not content
    contentPattern: null,
  },

  // Generic API key / secret / token assignments
  {
    name: 'API key or secret assignment',
    filePattern: null,
    contentPattern: /(?:api[_\-]?key|api[_\-]?secret|client[_\-]?secret|access[_\-]?token|auth[_\-]?token)\s*[=:]\s*['"`]?\w{8,}/i,
  },

  // AWS credentials
  {
    name: 'AWS Access Key ID',
    filePattern: null,
    contentPattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: 'AWS Secret Access Key',
    filePattern: null,
    contentPattern: /aws[_\-]?secret[_\-]?access[_\-]?key\s*[=:]\s*['"`]?[A-Za-z0-9/+=]{40}/i,
  },

  // Private keys / certificates
  {
    name: 'Private key block',
    filePattern: null,
    contentPattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/,
  },

  // Generic password assignment
  {
    name: 'Password assignment',
    filePattern: null,
    contentPattern: /(?:password|passwd|pwd)\s*[=:]\s*['"`]\S{6,}/i,
  },

  // GitHub / GitLab tokens
  {
    name: 'GitHub personal access token',
    filePattern: null,
    contentPattern: /gh[pousr]_[A-Za-z0-9]{36,}/,
  },
  {
    name: 'GitLab personal access token',
    filePattern: null,
    contentPattern: /glpat-[A-Za-z0-9\-]{20,}/,
  },

  // Stripe keys
  {
    name: 'Stripe secret key',
    filePattern: null,
    contentPattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/,
  },

  // Sendgrid API key
  {
    name: 'SendGrid API key',
    filePattern: null,
    contentPattern: /SG\.[A-Za-z0-9\-_]{22,}\.[A-Za-z0-9\-_]{43,}/,
  },

  // Slack tokens
  {
    name: 'Slack token',
    filePattern: null,
    contentPattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/,
  },

  // Twilio
  {
    name: 'Twilio auth token',
    filePattern: null,
    contentPattern: /AC[a-f0-9]{32}/,
  },

  // Generic bearer token in source
  {
    name: 'Hardcoded Bearer token',
    filePattern: null,
    contentPattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
  },

  // Private SSH key reference
  {
    name: 'SSH private key reference',
    filePattern: /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/,
    contentPattern: null,
  },

  // Connection strings
  {
    name: 'Database connection string',
    filePattern: null,
    contentPattern: /(?:mongodb|postgres|postgresql|mysql|redis|mssql):\/\/[^:]+:[^@]+@/i,
  },
];

/**
 * Scan an array of collected file objects for secrets.
 *
 * @param {Array<{ relativePosix: string, content: string }>} files
 * @returns {Array<{ file: string, reason: string }>}
 */
export function scanSecrets(files) {
  const warnings = [];

  for (const file of files) {
    const baseName = file.relativePosix.split('/').pop();
    const triggeredReasons = new Set();

    for (const pattern of SECRET_PATTERNS) {
      // Check filename pattern
      if (pattern.filePattern && pattern.filePattern.test(baseName)) {
        triggeredReasons.add(pattern.name);
      }

      // Check content pattern
      if (pattern.contentPattern && pattern.contentPattern.test(file.content)) {
        triggeredReasons.add(pattern.name);
      }
    }

    if (triggeredReasons.size > 0) {
      warnings.push({
        file: file.relativePosix,
        reason: [...triggeredReasons].join('; '),
      });
    }
  }

  return warnings;
}
