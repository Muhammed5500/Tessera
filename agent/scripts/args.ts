/** Basit `--anahtar deger` / `--bayrak` ayrıştırıcı. */
export function parseArgs(argv = process.argv.slice(2)) {
  const named: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) named[key] = "true";
      else {
        named[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { named, positional };
}
