#!/bin/bash
# Verify the user-mode game-dev toolchain on this host (see CLAUDE.md).
# Usage: tools/check-toolchain.sh   — exits non-zero if any check fails.
set -uo pipefail

fails=0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

check() { # name, command...
    local name=$1; shift
    local out
    if out=$("$@" 2>&1); then
        printf '  ok    %-16s %s\n' "$name" "$(printf '%s' "$out" | head -1 | cut -c1-70)"
    else
        printf '  FAIL  %-16s %s\n' "$name" "$(printf '%s' "$out" | tail -1 | cut -c1-70)"
        fails=$((fails + 1))
    fi
}

echo "versions:"
check node           node --version
check npm            npm --version
check uv             uv --version
check gamedev-python gamedev-python -c "import numpy, scipy, soundfile, pedalboard, pretty_midi, music21, librosa, PIL; print('media libs import')"
check ffmpeg         sh -c "ffmpeg -hide_banner -version | head -1"
check blender        sh -c "blender --version | head -1"
check fluidsynth     sh -c "fluidsynth --version 2>/dev/null | grep -m1 'FluidSynth runtime'"
check sox            sox --version
check magick         sh -c "magick -version | head -1"
check resvg          resvg --version
check gltf-transform gltf-transform --version
check gltfpack       sh -c "gltfpack -v 2>&1 | head -1"
check podman         sh -c "podman --version"
check rustc          rustc --version
check cargo          cargo --version
check wasm32-target  sh -c "rustup target list --installed | grep -x wasm32-unknown-unknown"
check wasm-opt       wasm-opt --version
check wasm-as        wasm-as --version
check clippy         cargo clippy --version
check rustfmt        rustfmt --version
check pyyaml         gamedev-python -c "import yaml; print('pyyaml', yaml.__version__)"
check numactl        sh -c "numactl --show | head -1"
check basisu         sh -c "basisu -version 2>&1 | grep -m1 -o 'Basis Universal.*'"
check jsonschema     gamedev-python -c "import importlib.metadata as m; print('jsonschema', m.version('jsonschema'))"

echo "functional:"
sf=$HOME/.local/share/soundfonts/GeneralUser-GS.sf2
check soundfont      test -s "$sf"
check audio-render   sh -c "
    gamedev-python -c \"import pretty_midi as p; m=p.PrettyMIDI(); i=p.Instrument(0); i.notes.append(p.Note(100,60,0,0.5)); m.instruments.append(i); m.write('$work/t.mid')\" &&
    fluidsynth -ni -q -F '$work/t.wav' '$sf' '$work/t.mid' >/dev/null 2>&1 &&
    ffmpeg -hide_banner -loglevel error -y -i '$work/t.wav' -c:a libopus '$work/t.ogg' &&
    test -s '$work/t.ogg' && echo 'MIDI -> FluidSynth -> Opus'"
check svg-render     sh -c "
    echo '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\" fill=\"red\"/></svg>' > '$work/t.svg' &&
    resvg '$work/t.svg' '$work/t.png' && magick identify '$work/t.png'"
check ktx2-xubc7    sh -c "
    magick -size 64x64 gradient:red-blue '$work/k.png' &&
    basisu -ktx2 -no_stats -xubc7 -quality 90 -linear '$work/k.png' -output_file '$work/k.ktx2' >/dev/null 2>&1 &&
    basisu -info '$work/k.ktx2' 2>&1 | grep -q 'DFD transfer func: 1 (LINEAR)' &&
    mkdir -p '$work/ku' && basisu -unpack -format_only 6 -no_ktx '$work/k.ktx2' -output_path '$work/ku' >/dev/null 2>&1 &&
    ls '$work/ku' | grep -q BC7 && echo 'PNG -> KTX2 XUBC7 with a linear DFD (the upload contract) -> BC7'"
check chrome-webgl2  node --input-type=module -e "
    import { chromium } from '$HOME/.local/lib/node_modules/playwright/index.mjs';
    const b = await chromium.launch();
    const p = await b.newPage();
    const r = await p.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        return gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : null;
    });
    await b.close();
    if (!r) throw new Error('no WebGL2');
    console.log(r);"
check rust-wasm      sh -c "
    mkdir -p '$work/rs/src' && cd '$work/rs' &&
    printf '[package]\nname = \"t\"\nversion = \"0.1.0\"\nedition = \"2024\"\n[lib]\ncrate-type = [\"cdylib\"]\n' > Cargo.toml &&
    printf '#[unsafe(no_mangle)]\npub extern \"C\" fn add(a: i32, b: i32) -> i32 { a + b }\n' > src/lib.rs &&
    cargo build -q --release --target wasm32-unknown-unknown &&
    wasm-opt -O3 target/wasm32-unknown-unknown/release/t.wasm -o t.wasm &&
    node -e \"WebAssembly.instantiate(require('fs').readFileSync('t.wasm')).then(r => { if (r.instance.exports.add(2, 3) !== 5) process.exit(1); console.log('cargo -> wasm32 -> wasm-opt -> Node') })\""
check firefox        node --input-type=module -e "
    import { firefox } from '$HOME/.local/lib/node_modules/playwright/index.mjs';
    const b = await firefox.launch();
    const p = await b.newPage();
    const ok = await p.evaluate(() => typeof Worker === 'function' && typeof WebAssembly === 'object');
    console.log('Firefox ' + b.version() + (ok ? ' (Worker, WebAssembly)' : ' MISSING FEATURES'));
    await b.close();
    if (!ok) process.exit(1);"
check blender-eevee  sh -c "
    blender -b --factory-startup -noaudio --python-expr \"
import bpy
s = bpy.context.scene
s.render.engine = 'BLENDER_EEVEE'
s.render.resolution_x = s.render.resolution_y = 64
s.render.filepath = '$work/e.png'
bpy.ops.render.render(write_still=True)
\" >/dev/null 2>&1 && test -s '$work/e.png' && echo 'EEVEE via Xvfb + Mesa llvmpipe'"

if [ "$fails" -eq 0 ]; then echo "all checks passed"; else echo "$fails check(s) failed"; fi
exit "$fails"
