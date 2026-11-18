/** The first non-empty line of CLI output, trimmed, for a notice detail. */
export const firstLine = (text: string): string | undefined =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
