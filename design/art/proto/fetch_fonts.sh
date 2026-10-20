#!/bin/sh
# Fetch the OFL fonts used by the UI skins into design/art/out/fonts (gitignored).
set -e
D="$(dirname "$0")/../out/fonts"
mkdir -p "$D"
B=https://github.com/google/fonts/raw/main/ofl
get() { [ -s "$D/$2" ] || curl -sSfL "$B/$1/$2" -o "$D/$2"; }
get titilliumweb TitilliumWeb-Regular.ttf
get titilliumweb TitilliumWeb-SemiBold.ttf
get titilliumweb TitilliumWeb-Bold.ttf
get titilliumweb OFL.txt; mv -f "$D/OFL.txt" "$D/OFL-TitilliumWeb.txt"
get courierprime CourierPrime-Regular.ttf
get courierprime CourierPrime-Bold.ttf
# static instances from the upstream repositories (the google/fonts copies are variable-only)
getu() { [ -s "$D/$(basename "$1")" ] || curl -sSfL "$1" -o "$D/$(basename "$1")"; }
for w in Regular SemiBold Bold; do
  getu https://github.com/IBM/plex/raw/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-$w.ttf
  getu https://github.com/impallari/Libre-Franklin/raw/master/fonts/TTF/LibreFranklin-$w.ttf
done
getu https://github.com/impallari/Libre-Franklin/raw/master/fonts/TTF/LibreFranklin-ExtraBold.ttf
get ibmplexmono IBMPlexMono-Regular.ttf || true
get ibmplexmono IBMPlexMono-SemiBold.ttf || true
ls -la "$D"
