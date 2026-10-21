// YDK = plain-text deck format that YGOPro, Dueling Nexus & co. import:
// "#main" / "#extra" / "!side" headers, one card passcode per line and copy.
const SECTIONS = [['main', '#main'], ['extra', '#extra'], ['side', '!side']];

/**
 * deck: { main|extra|side: [{ card, count }] }, byName: Map(lowercase name -> { id })
 * Cards unknown to byName are reported in `missing` instead of silently dropped.
 */
export function buildYdk(deck, byName) {
  const missing = new Set();
  const lines = ['#created by Frog OTK Lab'];
  for (const [key, header] of SECTIONS) {
    lines.push(header);
    for (const { card, count } of deck[key] || []) {
      const info = byName.get(card.toLowerCase());
      if (!info) { missing.add(card); continue; }
      for (let i = 0; i < count; i += 1) lines.push(String(info.id));
    }
  }
  return { text: `${lines.join('\n')}\n`, missing: [...missing] };
}
