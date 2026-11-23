// Usage: node tools/glbinfo.mjs <file.glb> [...]
// Prints a compact summary of each GLB: size, bbox, meshes, skins, animations, top nodes.
import fs from 'node:fs';
import path from 'node:path';

for (const f of process.argv.slice(2)) {
  try {
    const buf = fs.readFileSync(f);
    const jsonLen = buf.readUInt32LE(12);
    const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const m of j.meshes || []) for (const p of m.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (a && a.min) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]); }
    }
    let tris = 0;
    for (const m of j.meshes || []) for (const p of m.primitives) if (p.indices != null) tris += j.accessors[p.indices].count / 3;
    const anims = (j.animations || []).map(a => a.name);
    const scene = j.scenes[j.scene || 0];
    const top = scene.nodes.map(n => j.nodes[n].name + (j.nodes[n].children ? `[${j.nodes[n].children.map(c => j.nodes[c].name).slice(0, 14).join(',')}]` : ''));
    const bones = (j.skins || []).map(s => s.joints.length);
    const imgs = (j.images || []).length;
    console.log(`## ${path.basename(f)} ${(buf.length / 1e6).toFixed(1)}MB tris=${Math.round(tris)} meshes=${(j.meshes || []).length} mats=${(j.materials || []).length} imgs=${imgs} skins=${bones.join('/')}`);
    console.log(`   bbox(raw mesh) min=${mn.map(v => v.toFixed(2))} max=${mx.map(v => v.toFixed(2))}`);
    console.log(`   top: ${top.join(' | ').slice(0, 600)}`);
    if (anims.length) console.log(`   anims(${anims.length}): ${anims.join(', ').slice(0, 900)}`);
    if (j.skins && j.skins[0]) console.log(`   joints: ${j.skins[0].joints.slice(0, 70).map(n => j.nodes[n].name).join(',')}`);
    const meshNodes = j.nodes.filter(n => n.mesh != null).map(n => n.name).slice(0, 30);
    console.log(`   meshNodes: ${meshNodes.join(',')}`);
  } catch (e) { console.log(`## ${f} ERROR ${e.message}`); }
}
