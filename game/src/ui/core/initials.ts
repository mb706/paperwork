// The stand-in for an icon the art does not have yet: the name's initials, typed (two letters for one word,
// one per word otherwise, numbers kept: "Assembling machine 2" → "AM2").
export function initials(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => w.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] as string).slice(0, 2);
  return words
    .slice(0, 3)
    .map((w) => (/^\d+$/.test(w) ? w : (w[0] as string).toUpperCase()))
    .join('');
}
