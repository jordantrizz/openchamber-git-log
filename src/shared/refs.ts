// `%D` decorations: "HEAD -> main, tag: v1.2.0, origin/main". A ref name
// cannot contain a space, so the comma-space list is unambiguous except for a
// tag containing a comma, which git allows and this parser splits.

export interface Decorations {
  branches: string[];
  tags: string[];
  head: boolean;
}

export const parseDecorations = (raw: string): Decorations => {
  const branches: string[] = [];
  const tags: string[] = [];
  let head = false;

  for (const entry of raw.split(', ')) {
    const part = entry.trim();
    if (part === '') continue;

    if (part.startsWith('tag: ')) {
      const tag = part.slice('tag: '.length).trim();
      if (tag !== '') tags.push(tag);
      continue;
    }

    const arrow = part.indexOf(' -> ');
    if (arrow >= 0) {
      const source = part.slice(0, arrow).trim();
      const target = part.slice(arrow + 4).trim();
      if (source === 'HEAD') head = true;
      if (target !== '') branches.push(target);
      continue;
    }

    if (part === 'HEAD') {
      head = true;
      continue;
    }

    branches.push(part);
  }

  return { branches, tags, head };
};
