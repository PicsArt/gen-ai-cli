import { Args } from '@oclif/core';
import { Models } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';

/**
 * Top-level command names for completion, derived from the oclif command
 * registry (built from `commands-manifest.ts`) — never a hand-maintained list,
 * so a newly added command can't silently drop out of tab-completion.
 *
 * Subcommands (`models:info`, `batch:run`, …) collapse to their topic head
 * (`models`, `batch`); hidden commands are excluded.
 */
export function topLevelCommands(commands: ReadonlyArray<{ id: string; hidden?: boolean }>): string[] {
  const top = new Set<string>();
  for (const cmd of commands) {
    if (cmd.hidden) continue;
    const head = cmd.id.split(':')[0];
    if (head) top.add(head);
  }
  return [...top].sort();
}

/** Sanitize a string for safe interpolation into shell scripts. */
function shellSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '');
}

const GENERATE_FLAGS = [
  '--model',
  '-m',
  '--prompt',
  '-p',
  '--image',
  '-i',
  '--video',
  '--audio',
  '--duration',
  '-d',
  '--ar',
  '--aspect-ratio',
  '--resolution',
  '--count',
  '-n',
  '--quality',
  '--style',
  '--negative-prompt',
  '--cfg-scale',
  '--image-weight',
  '--audio-on',
  '--audio-off',
  '--enhance-prompt',
  '--silent',
  '-s',
  '--quiet',
  '-q',
  '--dry-run',
  '--download',
  '--no-download',
  '--save-to-drive',
  '--drive',
  '--drive-folder',
  '--debug',
  '--json',
  '--no-input',
  '--open',
  '--no-open',
  '--clipboard',
  '--bell',
  '--notify',
  '--prompt-file',
  '--help',
];

export function generateBashCompletion(modelIds: string[], commands: string[]): string {
  return `# gen-ai bash completion
# Add to ~/.bashrc: eval "$(gen-ai completion bash)"
_gen_ai() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands.join(' ')}"

  # Complete commands at position 1
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Complete model names after --model / -m
  if [[ "\${prev}" == "--model" || "\${prev}" == "-m" ]]; then
    local models="${modelIds.join(' ')}"
    COMPREPLY=( $(compgen -W "\${models}" -- "\${cur}") )
    return 0
  fi

  # Complete flags for generate
  if [[ "\${COMP_WORDS[1]}" == "generate" || "\${COMP_WORDS[1]}" == "redo" ]]; then
    if [[ "\${cur}" == -* ]]; then
      local flags="${GENERATE_FLAGS.join(' ')}"
      COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
      return 0
    fi
  fi

  # File completion for --image, --video, --audio, --prompt-file
  if [[ "\${prev}" == "--image" || "\${prev}" == "-i" || "\${prev}" == "--video" || "\${prev}" == "--audio" || "\${prev}" == "--prompt-file" ]]; then
    COMPREPLY=( $(compgen -f -- "\${cur}") )
    return 0
  fi

  return 0
}
complete -F _gen_ai gen-ai
`;
}

export function generateZshCompletion(modelIds: string[], commands: string[]): string {
  return `# gen-ai zsh completion
# Add to ~/.zshrc: eval "$(gen-ai completion zsh)"
_gen_ai() {
  local -a commands models
  commands=(${commands.map((c) => `'${c}'`).join(' ')})
  models=(${modelIds.map((m) => `'${m}'`).join(' ')})

  _arguments -C \\
    '1:command:($commands)' \\
    '*:: :->args'

  case $state in
    args)
      case $words[1] in
        generate|redo)
          _arguments \\
            '(-m --model)'{-m,--model}'[Model]:model:($models)' \\
            '(-p --prompt)'{-p,--prompt}'[Prompt]:prompt:' \\
            '(-i --image)'{-i,--image}'[Image]:image:_files' \\
            '--video[Video]:video:_files' \\
            '--audio[Audio]:audio:_files' \\
            '(-d --duration)'{-d,--duration}'[Duration]:duration:' \\
            '--ar[Aspect ratio]:ratio:' \\
            '--prompt-file[Prompt file]:file:_files' \\
            '(-s --silent)'{-s,--silent}'[Silent mode]' \\
            '(-q --quiet)'{-q,--quiet}'[Suppress info/progress output]' \\
            '--open[Auto-open result]' \\
            '--clipboard[Copy URL to clipboard]' \\
            '--json[JSON output]' \\
            '--no-input[Disable interactive prompts]' \\
            '--help[Show help]'
          ;;
        models)
          _arguments \\
            '1:subcommand:(list info params compare)' \\
            '--mode[Filter mode]:mode:(video image audio)' \\
            '--provider[Filter provider]:provider:' \\
            '--json[JSON output]'
          ;;
      esac
      ;;
  esac
}
compdef _gen_ai gen-ai
`;
}

export function generateFishCompletion(modelIds: string[], commands: string[]): string {
  return `# gen-ai fish completion
# Save to ~/.config/fish/completions/gen-ai.fish
${commands.map((c) => `complete -c gen-ai -n "__fish_use_subcommand" -a "${c}"`).join('\n')}
${modelIds.map((m) => `complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l model -a "${m}"`).join('\n')}
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -s p -l prompt -d "Prompt"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -s i -l image -rF -d "Image"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l video -rF -d "Video"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -s s -l silent -d "Silent mode"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -s q -l quiet -d "Suppress info/progress"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l json -d "JSON output"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l no-input -d "Disable interactive prompts"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l open -d "Auto-open"
complete -c gen-ai -n "__fish_seen_subcommand_from generate redo" -l clipboard -d "Copy URL"
`;
}

export default class Completion extends BaseCommand {
  static description = 'Generate shell completion scripts';

  static examples = [
    '<%= config.bin %> completion bash',
    '<%= config.bin %> completion zsh >> ~/.zshrc',
    '<%= config.bin %> completion fish | source',
  ];

  static args = {
    shell: Args.string({
      description: 'Shell type',
      required: true,
      options: ['bash', 'zsh', 'fish'],
    }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const { args } = await this.parse(Completion);
    const modelIds = Models.list()
      .filter((m) => !m.disabled)
      .map((m) => shellSafe(m.id));

    // Derived from the live oclif registry, not a hardcoded list.
    const commands = topLevelCommands(this.config.commands);

    switch (args.shell) {
      case 'bash':
        this.out.result(generateBashCompletion(modelIds, commands));
        break;
      case 'zsh':
        this.out.result(generateZshCompletion(modelIds, commands));
        break;
      case 'fish':
        this.out.result(generateFishCompletion(modelIds, commands));
        break;
      default:
        throw new UsageError(`Unknown shell: ${args.shell}. Supported: bash, zsh, fish`);
    }
  }
}
