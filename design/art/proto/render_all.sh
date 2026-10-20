#!/bin/sh
# Render every sprite and icon the mocks need, in one style, on socket 1 (CPUs 8-15, 24-31).
#   design/art/proto/render_all.sh kodachrome [threads]
# Each line is one Blender process; entities are rendered in sequence (never in parallel with
# another heavy job: the host is shared). Re-running overwrites; manifests are merged.
set -e
STYLE=$1
TH=${2:-16}
cd "$(dirname "$0")/../../.."
R="taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python design/art/proto/render.py -- --style $STYLE --threads $TH"
I="taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python design/art/proto/render_icons.py -- --style $STYLE --threads $TH"
run() { echo "== $*"; $R "$@" 2>&1 | grep -E '^\[render|Traceback|Error:' || true; }
run --entities stone-furnace,assembling-machine-1,seminar,small-electric-pole,wooden-chest,iron-chest,character
run --entities keypunch --frames 0,5,10,15
run --entities electric-mining-drill --directions N,E,S,W
run --entities boiler --directions W,S
run --entities steam-engine --variants 0
run --entities offshore-pump --directions N,S
run --entities pipe --variants 5,10
run --entities transport-belt
run --entities inserter,burner-inserter,long-handed-inserter --state base --variants 0
run --entities inserter,burner-inserter,long-handed-inserter --state arm
run --entities tree,big-rock,decorative
run --entities iron-ore,coal,copper-ore,quartz,archive
run --entities town-block,campus
echo "== icons"
$I --items all --buildings transport-belt,inserter,stone-furnace,keypunch,assembling-machine-1,seminar,electric-mining-drill,small-electric-pole,wooden-chest,boiler,steam-engine 2>&1 | grep -E '^\[icon|Traceback|Error:' | tr '\n' ' '
echo
