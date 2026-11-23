# TLV NONSTOP - module contract (read fully before writing code)

An ORIGINAL open-world action game set in Tel Aviv, running in the browser (three.js r170, plain ES modules, no bundler, no TypeScript).
Original title, characters, story, art and music. No names, characters, logos, UI look, music or text from any existing game. Never write "GTA" anywhere.
Theme of the competition: **accessibility**. The game runs on any computer in a browser with zero install, and ships real accessibility options (see `G.settings`).

- Run: `node serve.mjs 8080` -> http://127.0.0.1:8080/  (the LEAD runs and tests it; agents do NOT use the browser tools - one shared tab).
- Verify your file with `node --check src/<file>.js`. Be careful and defensive: nobody will debug your module for you before the demo.
- Each module = ONE file `src/<name>.js` that you own. Do not edit files you do not own (`core.js`, `main.js`, `index.html`, other modules).
- Imports allowed: `import * as THREE from 'three'`, `import { X } from 'three/addons/...'` (= node_modules/three/examples/jsm/), `import { G } from './core.js'`.
- Exports: `export async function init(G)`, `export function update(dt)`; optional `export function updatePaused(dt)` (called instead of update while the title screen/pause is up).
- Load order: `sky, world, fx, vehicles, player, npcs, police, missions, audio, hud`. In `init` you may use modules that loaded BEFORE you.
  Anything loaded after you (or that may have failed) must be reached with optional chaining at call time: `G.hud?.toast('...')`, `G.audio?.play('crash')`.
- A module that throws in `init` is skipped and the game continues, so guard everything that touches another module.
- Performance budget: 60 fps on a laptop GPU (RTX 3060). Use `InstancedMesh` / merged geometry for repeated things, share materials, avoid per-frame allocations, cap active dynamic lights (max ~6 point/spot lights total in the scene; use emissive materials + bloom for the rest). Only ONE shadow-casting light (the sun, owned by sky.js).
- Text is Hebrew first (RTL). All player-facing strings in Hebrew, tasteful and funny Tel Aviv flavour. Code/comments in English.

## Conventions
- Units: metres. Y up. Ground at y = 0. **East = +X, West = -X (the sea is in the west), South = +Z, North = -Z.**
- `heading` (radians): forward vector = `(sin(heading), 0, cos(heading))`, and `object3d.rotation.y = heading`. heading 0 looks toward +Z (south).
- Character GLBs (`assets/chars/*.glb`): 1.87 m tall, feet at y=0, one SkinnedMesh `Body`, 21 bones, clips:
  `idle, walk, run, wave, talk, celebrate, point, shrug, nod, shake_head, think, sit_down, sit_idle, stand_up, slump, handshake, sympathy, type, sit_talk ...`.
  They all share one skeleton. Files: `npc_a..npc_i` (civilians, 1.3-2 MB), `y3` (hero), `runner`, `en_grunt`, `en_warden`, `a7_grunt` (armoured/uniform types: use for police/guards).
  Load with `const gltf = await G.assets.loadGLB(url); const obj = G.assets.clone(gltf); const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'walk'), obj).play();`
  There is NO punch/shoot/drive/jump clip: do those procedurally (rotate arm bones `UpperArm.R`/`LowerArm.R` -> in three.js bone names lose the dot: `UpperArmR`; look bones up by trying both), or hide the character while driving.
  Which way the model faces at rotation.y = 0 is believed to be +Z; the lead will verify in the browser - keep a single `MODEL_YAW` constant per file so it is a one-line fix.
- Vehicle GLBs (`assets/vehicles/*.glb`): one mesh `Hull`, NO material, centred at origin (so lift by half height), length along Z, real size in metres. Front is believed to be -Z (Godot convention): keep a `MODEL_YAW` constant.
  `street_taxi_C, street_roadster_C, street_police_C, street_van_C, street_pickup_C, street_bike_scooter_C, street_bike_sporty_C, street_bike_police_C, courier_A/B/C` (the `_B` files are higher detail).
- Props (`assets/props/*.glb`, 1-6 MB each, textured, roughly unit sized, centred at origin - scale them): `palm, tree, lamp, bench, bin, foodcart, planter, shelter, vending, awning, balcony, shopfront, roof_ac, roof_solar, roof_tank, fern, tram, pistol, scatter, rail`.
- PBR textures `assets/tex/<Name>/{color,normal,rough,ao,emis,metal}.jpg` (not every map exists in every set): `Facade002, Facade009, Facade013, Facade017, Facade018A, Facade020B, Road012A, PavingStones128, PavingStones146, Plaster007, Concrete034, Tiles107`.
- Sounds `assets/sfx/*.ogg`: `crash_00..07, crash_big_00..05, bump_00..04, explosion_00..02, pistol_v1..v3, shotgun_v1..3, smg_v1..3, punch_00..02, hit_body_00..04, hurt_00..05, death_m_00..05, ped_scream_f_00..03, ped_hurt_f_00..06, step_asphalt_00..02, step_concrete_00..02, step_grass_00..02, door_00..04, loot_00..01, chime_00..01, ui_select_00..02, ui_error_00..01, crowd_loop, scrape_loop`.
- Music `assets/music/*.ogg`: `radio_pop_1, radio_pop_2, club_edm_1, club_edm_2, radio_underground_1, radio_underground_2, jazz_noir_1, bar_synthwave_1, explore_night_1, pursuit, street, night, venue_lounge, venue_warm`.
- Optional generated files (may not exist; check with `await G.assets.exists(url)` and fall back): `assets/gen/title.png`, `assets/gen/billboard_01.png .. billboard_08.png`, `assets/gen/radio_*.ogg`.
- Inspect any GLB: `node tools/glbinfo.mjs <file>`.

## G (see src/core.js for the exact code - read it)
`G.scene, G.camera, G.renderer, G.time, G.dt, G.started, G.paused, G.settings, G.setSetting(k,v), G.events.on/emit, G.input, G.assets, G.actors, G.raycastActors(origin, dir, maxDist, ignore), G.rand, G.pick, G.clamp, G.lerp, G.angleDiff, G.dist2D`

### Input (keyboard + mouse + gamepad; read `G.input` in core.js)
`G.input.axis.x/.y` (move/steer), `G.input.down(code)`, `G.input.pressed(code)`, `G.input.mouse.dx/dy` (pointer-locked look), `G.input.mouseDown(0)`, `G.input.mousePressed(0)`.
Key map (keep it consistent): WASD/arrows move & drive, Shift sprint / boost, Space jump / handbrake, **F** enter-exit vehicle, **E** interact / talk / start mission,
LMB attack/shoot, RMB aim, **1/2/3** or wheel weapon, **R** next radio station, **H** horn, **C** camera mode, **M** big map, **Esc / P** pause menu, **Tab** accessibility menu, **L** headlights.
Gamepad: left stick = axis, right stick feeds mouse.dx/dy, buttons via `G.input.padDown(i)` (0=A jump/handbrake, 1=B, 2=X enter/exit, 3=Y, 7=RT gas/shoot, 6=LT brake/aim).

### Events (emit with a plain object)
- `crime` `{ type:'hit_ped'|'kill_ped'|'shoot'|'carjack'|'hit_car'|'hit_cop'|'kill_cop'|'speeding', pos:Vector3, severity:1..3 }` -> police.js raises the wanted level
- `vehicle:crash` `{ vehicle, speed, pos }`, `vehicle:destroyed` `{ vehicle, pos }`
- `player:enterVehicle` `{ vehicle }`, `player:exitVehicle` `{ vehicle }`, `player:died` `{}`, `player:respawn` `{}`, `player:damage` `{ amount }`
- `npc:killed` `{ actor }`, `wanted:change` `{ level }`, `money` `{ amount, total }`
- `mission:start|complete|fail` `{ id, title }`, `settings:change` `{ key, value }`, `ready` (all modules loaded), `game:start` (title screen dismissed), `resize`

### G.world (world.js)
```
G.world = {
  bounds: { minX, maxX, minZ, maxZ },        // playable land + a strip of sea
  seaX,                                       // x of the shoreline: water for x < seaX
  spawn: { x, z, heading },                   // player start (on a sidewalk next to a parked car spot)
  colliders: [ { minX, maxX, minZ, maxZ, h } ],   // static boxes (buildings, big props)
  resolveCircle(p, r),        // p = {x,z} (a Vector3 works): pushes p out of colliders + world bounds. Returns null or { nx, nz } (surface normal of what was hit)
  blocked(x, z, r),           // boolean
  raycast(origin, dir, maxDist),   // vs buildings: null or { dist, point:Vector3, normal:Vector3 }
  groundY(x, z),              // 0 on land, slightly below on the beach slope, negative in the sea
  surfaceAt(x, z),            // 'road' | 'sidewalk' | 'plaza' | 'grass' | 'sand' | 'water' | 'building'
  roads: { nodes: [ { id, x, z, links:[id,...] } ], laneOffset, halfWidth },   // intersections graph; two-way streets, drive on the RIGHT
  nearestNode(x, z),          // -> node
  randomRoadPoint(nearPos?, minDist?, maxDist?),      // -> { x, z, heading, nodeA, nodeB } a point in a right-hand lane, heading along the lane
  randomSidewalkPoint(nearPos?, minDist?, maxDist?),  // -> { x, z, heading }
  path(fromNodeId, toNodeId), // -> [node ids] shortest path (A* / BFS)
  landmarks: { key: { x, z, name } },   // keys at least: dizengoff, azrieli, rothschild, beach, jaffa, carmel, port, sarona, habima, florentin
  districtAt(x, z),           // Hebrew district name, e.g. 'פלורנטין'
  streetAt(x, z),             // Hebrew street name of the nearest road, e.g. 'אלנבי'
  parkingSpots: [ { x, z, heading } ],  // curb-side spots for parked cars (at least 60)
}
```
### G.sky (sky.js): `G.sky = { hour (0..24 float), isNight (bool), sunDir:Vector3, setHour(h), timeScale }`. Also owns sun/ambient lights, fog, sky dome, sea water mesh, post-processing (`G.renderFrame`).
### G.fx (fx.js): `explosion(pos, scale=1)`, `sparks(pos, dir?)`, `smoke(pos, opts?)`, `muzzleFlash(pos, dir)`, `tracer(from, to)`, `hitPuff(pos)`, `tireSmoke(pos)`, `splash(pos)`, `shake(intensity 0..1)`, `shakeOffset:Vector3` (the camera owner adds it), `moneyPop(pos, amount)`, `flash(color, ms)`.
### G.vehicles (vehicles.js)
```
G.vehicles = {
  list: [ vehicle ],
  spawn(type, x, z, heading, opts?) -> vehicle,   // type: 'taxi'|'roadster'|'van'|'pickup'|'police'|'scooter'|'sportbike'|'policebike'|'courier'; opts: { ai:'traffic'|'parked'|'police'|null, color }
  remove(vehicle),
  nearest(pos, maxDist, filterFn?) -> vehicle | null,
  setPlayerVehicle(vehicle | null),   // player.js calls this on enter/exit; vehicles.js then drives it from G.input
  raycast(origin, dir, maxDist) -> { vehicle, dist, point } | null,
}
vehicle = { id, type, pos:Vector3, heading, speed (m/s signed, forward +), vel:Vector3, object3d, radius, length, width,
            driver: null|'player'|'traffic'|'police', isPolice, isBike, health (0..100), destroyed, seatOffset:Vector3,
            damage(amount, from), explode(), ai: {...} | null, target: {x,z}|null (police/AI steering target), sirenOn }
```
vehicles.js owns: car models (hull + wheels + lights + glass), arcade physics, collisions with world + other vehicles + actors (calls `actor.damage()` and emits `crime`/`vehicle:crash`), traffic AI on `G.world.roads`, parked cars. It also steers any vehicle with `driver==='police'` toward `vehicle.target` (police.js sets target).
### G.player (player.js)
```
G.player = { pos:Vector3, heading, vel:Vector3, object3d, health (0..100), armor, money, alive,
             inVehicle: vehicle|null, weapon: 'fists'|'pistol'|'smg', ammo:{pistol,smg}, isSprinting, isAiming,
             damage(amount, from), heal(n), addMoney(n), teleport(x, z, heading?), giveWeapon(name, ammo), camYaw, camPitch }
```
player.js owns: hero character + animation, on-foot movement/collision, third-person camera on foot AND in vehicles (chase cam), enter/exit (F), fists/pistol/smg (raycast via `G.raycastActors`, `G.vehicles.raycast`, `G.world.raycast`), death + respawn at hospital, swimming-lite in the sea.
### G.npcs (npcs.js): `G.npcs = { list:[ped], count, panicAt(pos, radius), spawnAt(x, z, opts) }`; each ped is also pushed to `G.actors` (kind 'ped') with `damage(amount, from)`. Owns pedestrians (pooled near the player), their reactions, ambient life (cafe sitters, beach people, dog walkers, electric-scooter riders...).
### G.wanted (police.js): `G.wanted = { level (0..5), heat, add(amount, reason), clear(), searching (bool) }`. Owns police response: patrol cars with sirens, officers on foot (actors kind 'cop'), roadblocks, arrest ("busted" -> original Hebrew text), escape/cooldown.
### G.missions (missions.js): `G.missions = { list, active, start(id), fail(reason), completed:Set }`. Owns mission givers/markers in the world, checkpoints, timers, rewards, pickups, side activities.
### G.audio (audio.js): `play(name, { pos?:Vector3, volume?, pitch? })` (name = sfx base name without the `_00` index, random variant; e.g. 'crash', 'crash_big', 'pistol', 'punch', 'explosion', 'door', 'loot', 'chime', 'ui_select', 'ui_error', 'hurt', 'death_m', 'ped_scream_f', 'step_asphalt', 'bump', 'horn', 'siren'), `music(name|null)`, `radio = { stations, index, next(), prev(), off(), current }`, `engine(vehicle|null)` handled internally from `G.player.inVehicle`, `caption(text)`.
### G.hud (hud.js): `toast(text, ms?)`, `subtitle(speaker, text, ms?)`, `setObjective(text|null)`, `bigText(title, sub?, ms?)` (mission passed/failed style banner, original design), `announce(text)` (aria-live + optional speech), `addBlip(id, { x, z, color, icon, label, follow? })`, `removeBlip(id)`, `setRoute([{x,z},...]|null)` (GPS line on the minimap), `prompt(text|null)` (contextual "F - להיכנס לרכב"), `showMenu(name)`, `timer(seconds|null)`, `caption(text)` (sound captions for deaf players).
