type RetiredScriptOptions = {
  readonly guidance: readonly string[];
  readonly script: string;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function runRetiredScript({ guidance, script }: RetiredScriptOptions): void {
  writeStderr(`${script} has been retired.`);
  writeStdout('Use a supported workflow instead:');

  for (const note of guidance) {
    writeStdout(`- ${note}`);
  }

  process.exitCode = 2;
}
