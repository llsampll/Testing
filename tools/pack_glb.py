#!/usr/bin/env python3
"""Pack a .gltf (+ .bin + textures) into a single .glb.

If a referenced texture file is missing, the image/texture references are
removed so the model still loads (the game then uses plain colours).

Usage: python3 tools/pack_glb.py models/src/spec-e36/scene.gltf models/spec-e36.glb
"""
import json
import os
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
base = os.path.dirname(src)
gltf = json.load(open(src))
bin_data = bytearray(open(os.path.join(base, gltf['buffers'][0]['uri']), 'rb').read())

def pad4(b, fill=b'\0'):
    while len(b) % 4:
        b += fill
    return b

# Embed images that exist; drop textures whose image file is missing.
missing = []
for i, img in enumerate(gltf.get('images', [])):
    path = os.path.join(base, img.get('uri', ''))
    if os.path.exists(path):
        data = open(path, 'rb').read()
        pad4(bin_data)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin_data), 'byteLength': len(data)})
        bin_data += data
        img.pop('uri')
        img['bufferView'] = len(gltf['bufferViews']) - 1
        img['mimeType'] = 'image/png' if path.lower().endswith('.png') else 'image/jpeg'
    else:
        missing.append(img.get('uri'))
if missing:
    for mat in gltf.get('materials', []):
        pbr = mat.get('pbrMetallicRoughness', {})
        pbr.pop('baseColorTexture', None)
    for key in ('images', 'textures', 'samplers'):
        gltf.pop(key, None)

pad4(bin_data)
gltf['buffers'] = [{'byteLength': len(bin_data)}]
js = pad4(bytearray(json.dumps(gltf, separators=(',', ':')).encode()), b' ')
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_data))
out += struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bin_data), b'BIN\0') + bin_data
open(dst, 'wb').write(out)
print(f'wrote {dst} ({len(out)} bytes)' + (f'; missing textures: {missing}' if missing else ''))
