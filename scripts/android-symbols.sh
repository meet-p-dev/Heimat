#!/bin/sh
# Downloads the Material Symbols Rounded font, cut down to the icons named in
# src/android/symbols.ts, for the Android build (bundled, so it works offline).
# Run again after adding an icon to SYMBOL.
set -e
cd "$(dirname "$0")/.."
names=$(python3 -c "import re;print(','.join(sorted(set(re.findall(r\":\s*'([a-z0-9_]+)'\",open('src/android/symbols.ts').read())))))")
ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
css=$(curl -s -A "$ua" "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=$names&display=block")
url=$(echo "$css" | grep -oE "url\(https://[^)]+\)" | head -1 | sed 's/^url(//;s/)$//')
curl -s -o src/android/assets/material-symbols-rounded.woff2 "$url"
echo "src/android/assets/material-symbols-rounded.woff2: $(wc -c < src/android/assets/material-symbols-rounded.woff2) bytes"
# and the icon components themselves, one per name in SYMBOL
python3 - <<'PY'
import re
sym = open('src/android/symbols.ts').read()
pairs = re.findall(r"(\w+):\s*'([a-z0-9_]+)'", sym.split('= {', 1)[1])
p = 'src/android/lucide.tsx'
head = open(p).read().split('export const ', 1)[0]
open(p, 'w').write(head + ''.join(f"export const {n} = make('{s}', '{n}')\n" for n, s in pairs))
print(f'{p}: {len(pairs)} icons')
PY
