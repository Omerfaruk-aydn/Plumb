/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F24 (PLUMB-UI-DEVRIM-PROMPT.md): pure shell-completion-script generators.
 * No I/O, no process access -- `generateCompletion(shell, metadata)` takes
 * whatever `collectCompletionMetadata()` already gathered and renders a
 * self-contained script for one of four shells. All list items are quoted
 * per-shell so completion candidates containing spaces or quotes (a session
 * name, say) survive as a single candidate rather than being word-split.
 */

export type CompletionShell = 'bash' | 'zsh' | 'fish' | 'powershell';

export const COMPLETION_SHELLS: readonly CompletionShell[] = [
  'bash',
  'zsh',
  'fish',
  'powershell',
];

export interface CompletionMetadataInput {
  slashCommands: readonly string[];
  flags: readonly string[];
  models: readonly string[];
  sessions: readonly string[];
}

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function fishQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function bashArrayLiteral(name: string, items: readonly string[]): string {
  const body = items.map(bashQuote).join(' ');
  return `  local -a ${name}=(${body})`;
}

function fishList(items: readonly string[]): string {
  return items.map(fishQuote).join(' ');
}

function powershellArrayLiteral(
  name: string,
  items: readonly string[],
): string {
  const body = items.map(powershellQuote).join(', ');
  return `    $${name} = @(${body})`;
}

function generateBash(metadata: CompletionMetadataInput): string {
  const flags = [...metadata.flags, ...metadata.slashCommands];
  return `# PLUMB bash completion
# Install: eval "$(plumb completions bash)"
_plumb_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

${bashArrayLiteral('plumb_flags', flags)}
${bashArrayLiteral('plumb_models', metadata.models)}
${bashArrayLiteral('plumb_sessions', metadata.sessions)}

  local -a candidates=()
  case "$prev" in
    --model)
      candidates=("\${plumb_models[@]}")
      ;;
    --resume)
      candidates=("\${plumb_sessions[@]}")
      ;;
    *)
      candidates=("\${plumb_flags[@]}")
      ;;
  esac

  COMPREPLY=()
  local item
  for item in "\${candidates[@]}"; do
    if [[ "$item" == "$cur"* ]]; then
      COMPREPLY+=("$item")
    fi
  done
}
complete -F _plumb_completions plumb
`;
}

function generateZsh(metadata: CompletionMetadataInput): string {
  const flags = [...metadata.flags, ...metadata.slashCommands];
  return `#compdef plumb
# PLUMB zsh completion
# Install: eval "$(plumb completions zsh)"
_plumb() {
  local -a plumb_flags plumb_models plumb_sessions
  plumb_flags=(${flags.map(bashQuote).join(' ')})
  plumb_models=(${metadata.models.map(bashQuote).join(' ')})
  plumb_sessions=(${metadata.sessions.map(bashQuote).join(' ')})

  case "\${words[CURRENT-1]}" in
    --model)
      compadd -a plumb_models
      return
      ;;
    --resume)
      compadd -a plumb_sessions
      return
      ;;
  esac

  compadd -a plumb_flags
}
_plumb "$@"
`;
}

function generateFish(metadata: CompletionMetadataInput): string {
  const flags = [...metadata.flags, ...metadata.slashCommands];
  const lines: string[] = [
    '# PLUMB fish completion',
    '# Install: plumb completions fish | source',
    `complete -c plumb -f -a ${fishList(flags)}`,
  ];
  if (metadata.models.length > 0) {
    lines.push(
      `complete -c plumb -n '__fish_seen_argument -l model' -f -a ${fishList(metadata.models)}`,
    );
  }
  if (metadata.sessions.length > 0) {
    lines.push(
      `complete -c plumb -n '__fish_seen_argument -l resume' -f -a ${fishList(metadata.sessions)}`,
    );
  }
  return lines.join('\n') + '\n';
}

function generatePowershell(metadata: CompletionMetadataInput): string {
  const flags = [...metadata.flags, ...metadata.slashCommands];
  return `# PLUMB PowerShell completion
# Install: plumb completions powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName plumb -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

${powershellArrayLiteral('plumbFlags', flags)}
${powershellArrayLiteral('plumbModels', metadata.models)}
${powershellArrayLiteral('plumbSessions', metadata.sessions)}

    $elements = $commandAst.CommandElements
    $prev = if ($elements.Count -ge 2) { $elements[$elements.Count - 2].Extent.Text } else { '' }

    $candidates = switch ($prev) {
        '--model' { $plumbModels }
        '--resume' { $plumbSessions }
        default { $plumbFlags }
    }

    $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
}

export function generateCompletion(
  shell: CompletionShell,
  metadata: CompletionMetadataInput,
): string {
  switch (shell) {
    case 'bash':
      return generateBash(metadata);
    case 'zsh':
      return generateZsh(metadata);
    case 'fish':
      return generateFish(metadata);
    case 'powershell':
      return generatePowershell(metadata);
    default: {
      const exhaustive: never = shell;
      throw new Error(`Unsupported shell: ${String(exhaustive)}`);
    }
  }
}
