import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from './config.js';
import { updatePlayerPhysics } from './physics.js';
import { createPlayerVitals } from './playerVitals.js';
import { createBowState, getBowHudState, setBowHeld, updateBowState } from './bow.js';
import { createBowView, createCarriedBow } from './bowView.js';
import { createDashState, getDashHudState, updateDashInput, updateDashState } from './dash.js';
import { createHost, createClient, MAX_PLAYERS } from './net.js';
import { createOnlineHud } from './onlineHud.js';

const PLAYER_CONFIG = CONFIG.mecanicas?.jogador ?? {};
const BOW_CONFIG = CONFIG.mecanicas?.arco ?? {};
const CROUCH_CONFIG = CONFIG.mecanicas?.agachar ?? {};
const HITBOX_RADIUS = PLAYER_CONFIG.raioColisao ?? 0.55;
const HITBOX_HEIGHT = PLAYER_CONFIG.alturaColisao ?? 2.0;
const CROUCH_HITBOX_MULTIPLIER = CROUCH_CONFIG.multiplicadorAlturaHitbox ?? 0.62;
const EYE_HEIGHT = CONFIG.terreno.alturaOlhos ?? 2;
const SEND_INTERVAL = 0.05;
const PLACEMENT_BONUS = [5, 2, 1];
const PLAYER_COLORS = [
    0x2f7dff, 0xff8a2f, 0x35c759, 0xff3b30, 0xffd60a,
    0xaf52de, 0x00c7be, 0xff7ab8, 0x9b9b9b, 0x5ac8fa
];

const shotDirection = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function colorHex(color) {
    return `#${new THREE.Color(color).getHexString()}`;
}

function parseColorHex(color, fallback = 0xffffff) {
    if (typeof color === 'number' && Number.isFinite(color)) return color;
    if (typeof color !== 'string') return fallback;

    const clean = color.startsWith('#') ? color.slice(1) : color;
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;

    return Number.parseInt(clean, 16);
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function createRemoteBlock(color) {
    const group = new THREE.Object3D();
    const geometry = new THREE.BoxGeometry(1.1, 2, 1.1);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    const body = new THREE.Mesh(geometry, material);
    body.position.y = -EYE_HEIGHT / 2;
    body.castShadow = false;
    body.receiveShadow = false;
    group.add(body);
    const carriedBow = createCarriedBow();
    group.add(carriedBow.object);
    return { group, body, geometry, material, carriedBow };
}

function updateRemoteBodyPose(entry) {
    const isCrouching = Boolean(entry.target.isCrouching);
    entry.body.scale.y = isCrouching ? CROUCH_HITBOX_MULTIPLIER : 1;
    entry.body.position.y = isCrouching
        ? -(CROUCH_CONFIG.alturaOlhos ?? EYE_HEIGHT) / 2
        : -EYE_HEIGHT / 2;
}

export function createOnlineMode({
    scene,
    camera,
    renderer,
    getHeight,
    getSample,
    resolveTreeCollision,
    requestStart,
    room,
    isHost,
    seedText,
    playerName
}) {
    const controls = new PointerLockControls(camera, document.body);
    const player = controls.getObject();
    scene.add(player);

    const localVitals = createPlayerVitals({ id: 'local', label: playerName });
    const bow = createBowState();
    const dash = createDashState();
    const bowView = createBowView(scene, camera);
    const localState = { velocidadeY: 0, noChao: false, fallPeakY: null };
    const localHitbox = { radius: HITBOX_RADIUS, height: HITBOX_HEIGHT, standingHeight: HITBOX_HEIGHT };

    const keys = { w: false, a: false, s: false, d: false, space: false, shift: false, crouch: false };
    const remotes = new Map();
    const remoteShotQueue = [];

    let myName = playerName || 'Jogador';
    let localId = isHost ? 'host' : null;
    let phase = 'connecting';
    let mouseShootHeld = false;
    let isStarting = false;
    let netAccum = 0;
    let wasDead = false;
    let deathHandled = false;
    let lastArrowKillerId = null;
    let finalConnectionStatus = null;

    // ---- host authoritative state ----
    const roster = new Map();
    const match = { active: false, alive: new Set(), deathsOrder: [], processed: new Set() };
    let host = null;
    let client = null;

    const menu = document.getElementById('menu');
    if (menu) menu.style.display = 'none';
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'block';

    const hud = createOnlineHud({
        isHost,
        code: room,
        onStart: handleStartRequest,
        onNewRound: handleStartRequest,
        onRename: handleRename,
        onJoinWorld: start
    });
    localVitals.label = myName;

    // ---------------------------------------------------------------
    // Networking setup
    // ---------------------------------------------------------------
    if (isHost) {
        roster.set('host', {
            id: 'host',
            name: myName,
            color: PLAYER_COLORS[0],
            score: 0,
            kills: 0,
            lastState: null
        });
        host = createHost(room, {
            onReady() {
                phase = 'lobby';
                hud.setRoomCode(room);
                hud.setPhase('lobby');
                hud.setStatus('Sala aberta. Compartilhe o codigo.');
            },
            onError(err) {
                hud.setStatus(`Erro ao abrir sala: ${err?.type || err?.message || err}`);
            },
            onConnect(conn) {
                host.sendTo(conn, { t: 'welcome', seed: seedText, code: room });
            },
            onData: handleHostData,
            onDisconnect(conn) {
                removeHostPlayer(conn.peer);
            }
        });
    } else {
        phase = 'connecting';
        hud.setPhase('lobby');
        hud.setStatus('Conectando a sala...');
        client = createClient(room, {
            onOpen() {
                localId = client.id;
                phase = 'lobby';
                hud.setStatus('Conectado. Aguarde o host iniciar.');
                client.send({ t: 'join', name: myName });
            },
            onData: handleClientData,
            onClose() {
                hud.setStatus(finalConnectionStatus || 'Conexao com a sala encerrada.');
            },
            onError(err) {
                hud.setStatus(`Falha de conexao: ${err?.type || err?.message || err}`);
            }
        });
    }

    // ---------------------------------------------------------------
    // Host message handling
    // ---------------------------------------------------------------
    function nextColor() {
        return PLAYER_COLORS[roster.size % PLAYER_COLORS.length];
    }

    function handleHostData(conn, data) {
        if (!data || typeof data !== 'object') return;
        switch (data.t) {
            case 'join': {
                if (roster.has(conn.peer)) break;
                if (match.active) {
                    host.sendTo(conn, { t: 'busy' });
                    window.setTimeout(() => conn.close?.(), 80);
                    break;
                }
                if (roster.size >= MAX_PLAYERS) {
                    host.sendTo(conn, { t: 'full' });
                    window.setTimeout(() => conn.close?.(), 80);
                    break;
                }
                roster.set(conn.peer, {
                    id: conn.peer,
                    name: String(data.name || 'Jogador').slice(0, 16) || 'Jogador',
                    color: nextColor(),
                    score: 0,
                    kills: 0,
                    lastState: null
                });
                break;
            }
            case 'rename': {
                const entry = roster.get(conn.peer);
                if (entry) entry.name = String(data.name || entry.name).slice(0, 16) || entry.name;
                break;
            }
            case 'state': {
                const entry = roster.get(conn.peer);
                if (entry) entry.lastState = data.state;
                break;
            }
            case 'shot': {
                const shot = sanitizeShotMessage(data, conn.peer);
                if (!shot) break;
                queueRemoteShot(shot);
                host.broadcast(shot, conn.peer);
                break;
            }
            case 'death': {
                processDeath(conn.peer, data.killerId ?? null);
                break;
            }
            default:
                break;
        }
    }

    function removeHostPlayer(peerId) {
        if (!roster.has(peerId)) return;
        if (match.active && match.alive.has(peerId)) {
            processDeath(peerId, null);
        }
        roster.delete(peerId);
    }

    function processDeath(victimId, killerId) {
        if (!match.active || match.processed.has(victimId)) return;
        match.processed.add(victimId);
        match.deathsOrder.push(victimId);
        match.alive.delete(victimId);

        if (killerId && killerId !== victimId && roster.has(killerId)) {
            const killer = roster.get(killerId);
            killer.score += 1;
            killer.kills += 1;
        }

        if (match.alive.size <= 1) {
            endMatch();
        }
    }

    function computeSpawns(ids) {
        const out = {};
        const list = [...ids];
        const radius = 14;
        list.forEach((id, index) => {
            const angle = (index / Math.max(1, list.length)) * Math.PI * 2;
            out[id] = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
        });
        return out;
    }

    function buildScoreboard() {
        return [...roster.values()].map((entry) => ({
            id: entry.id,
            name: entry.name,
            color: colorHex(entry.color),
            score: entry.score,
            kills: entry.kills
        }));
    }

    function sanitizeShotMessage(data, ownerId) {
        if (!ownerId) return null;
        if (
            !isFiniteNumber(data.ox)
            || !isFiniteNumber(data.oy)
            || !isFiniteNumber(data.oz)
            || !isFiniteNumber(data.dx)
            || !isFiniteNumber(data.dy)
            || !isFiniteNumber(data.dz)
        ) return null;

        shotDirection.set(Number(data.dx), Number(data.dy), Number(data.dz));
        if (shotDirection.lengthSq() < 0.0001) return null;

        const maxLevel = Math.max(1, BOW_CONFIG.niveis ?? 4);
        const level = THREE.MathUtils.clamp(Math.round(Number(data.level) || 1), 1, maxLevel);
        return {
            t: 'shot',
            ownerId,
            ox: Number(data.ox),
            oy: Number(data.oy),
            oz: Number(data.oz),
            dx: shotDirection.x,
            dy: shotDirection.y,
            dz: shotDirection.z,
            level
        };
    }

    function startMatch() {
        if (!isHost) return;
        if (roster.size < 2) {
            hud.setStatus('Sao necessarios pelo menos 2 jogadores.');
            return;
        }
        match.active = true;
        match.alive = new Set(roster.keys());
        match.deathsOrder = [];
        match.processed = new Set();
        const spawns = computeSpawns(roster.keys());
        host.broadcast({ t: 'matchStart', spawns });
        startLocalMatch(spawns);
        start();
    }

    function endMatch() {
        if (!isHost) return;
        match.active = false;
        const finishing = [...match.alive, ...match.deathsOrder.slice().reverse()];
        const placements = finishing.map((id, index) => {
            const bonus = PLACEMENT_BONUS[index] ?? 0;
            const entry = roster.get(id);
            if (bonus && entry) entry.score += bonus;
            return {
                id,
                name: entry?.name ?? 'Jogador',
                place: index + 1,
                bonus
            };
        });
        const payload = { t: 'matchEnd', placements, scoreboard: buildScoreboard() };
        host.broadcast(payload);
        showResults(payload);
    }

    function broadcastSnapshot() {
        const players = [...roster.values()].map((entry) => {
            const s = entry.lastState || {};
            return {
                id: entry.id,
                name: entry.name,
                color: colorHex(entry.color),
                score: entry.score,
                kills: entry.kills,
                x: s.x ?? 0,
                y: s.y ?? 0,
                z: s.z ?? 0,
                yaw: s.yaw ?? 0,
                pitch: s.pitch ?? 0,
                isDead: Boolean(s.isDead),
                moving: Boolean(s.moving),
                bow: s.bow ?? null,
                crouching: Boolean(s.crouching)
            };
        });
        const snap = { t: 'snapshot', players, match: { active: match.active, alive: match.alive.size } };
        host.broadcast(snap);
        applySnapshot(snap);
    }

    // ---------------------------------------------------------------
    // Client message handling
    // ---------------------------------------------------------------
    function handleClientData(data) {
        if (!data || typeof data !== 'object') return;
        switch (data.t) {
            case 'welcome':
                hud.setStatus('Na sala. Aguarde o host iniciar.');
                break;
            case 'full':
                finalConnectionStatus = 'Sala cheia (maximo de 10 jogadores).';
                hud.setStatus(finalConnectionStatus);
                break;
            case 'busy':
                finalConnectionStatus = 'Partida em andamento. Tente entrar na proxima rodada.';
                hud.setStatus(finalConnectionStatus);
                break;
            case 'snapshot':
                applySnapshot(data);
                break;
            case 'shot':
                if (data.ownerId !== localId) queueRemoteShot(data);
                break;
            case 'matchStart':
                startLocalMatch(data.spawns);
                break;
            case 'matchEnd':
                showResults(data);
                break;
            default:
                break;
        }
    }

    // ---------------------------------------------------------------
    // Shared: snapshot / remotes
    // ---------------------------------------------------------------
    function ensureRemote(id, color) {
        let entry = remotes.get(id);
        if (entry) return entry;
        const block = createRemoteBlock(color ?? 0xffffff);
        scene.add(block.group);
        entry = {
            ...block,
            desired: new THREE.Vector3(),
            hasDesired: false,
            target: {
                id,
                position: block.group.position,
                hitbox: { radius: HITBOX_RADIUS, height: HITBOX_HEIGHT, standingHeight: HITBOX_HEIGHT },
                vitals: { isDead: false }
            }
        };
        remotes.set(id, entry);
        return entry;
    }

    function removeRemote(id) {
        const entry = remotes.get(id);
        if (!entry) return;
        scene.remove(entry.group);
        entry.carriedBow?.dispose();
        entry.geometry.dispose();
        entry.material.dispose();
        remotes.delete(id);
    }

    function applySnapshot(snap) {
        const seen = new Set();
        for (const p of snap.players) {
            if (p.id === localId) continue;
            seen.add(p.id);
            const entry = ensureRemote(p.id, parseColorHex(p.color));
            entry.desired.set(p.x, p.y, p.z);
            if (!entry.hasDesired) {
                entry.group.position.copy(entry.desired);
                entry.hasDesired = true;
            }
            entry.label = p.name || 'Jogador';
            entry.color = p.color;
            entry.group.rotation.y = p.yaw ?? 0;
            if (entry.carriedBow?.object) {
                const pitch = THREE.MathUtils.clamp(p.pitch ?? 0, -Math.PI / 2, Math.PI / 2);
                entry.carriedBow.object.rotation.x = 0.12 + pitch * 0.65;
            }
            entry.target.isCrouching = Boolean(p.crouching);
            entry.target.hitbox.height = entry.target.isCrouching
                ? entry.target.hitbox.standingHeight * CROUCH_HITBOX_MULTIPLIER
                : entry.target.hitbox.standingHeight;
            updateRemoteBodyPose(entry);
            entry.target.vitals.isDead = Boolean(p.isDead);
            entry.group.visible = !p.isDead;
            entry.carriedBow?.update(p.bow, !p.isDead);
        }
        for (const id of [...remotes.keys()]) {
            if (!seen.has(id)) removeRemote(id);
        }

        hud.setRoster(snap.players, localId);
        if (isHost) {
            const canStart = roster.size >= 2 && phase !== 'playing';
            hud.setCanStart(canStart);
        }
    }

    function updateRemotes(delta) {
        const t = Math.min(1, delta * 12);
        for (const entry of remotes.values()) {
            if (entry.hasDesired) entry.group.position.lerp(entry.desired, t);
        }
    }

    // ---------------------------------------------------------------
    // Match lifecycle (local)
    // ---------------------------------------------------------------
    function startLocalMatch(spawns) {
        phase = 'playing';
        localVitals.reset();
        deathHandled = false;
        wasDead = false;
        lastArrowKillerId = null;
        localState.velocidadeY = 0;
        localState.noChao = false;
        localState.fallPeakY = null;

        const spawn = spawns?.[localId];
        if (spawn) {
            player.position.set(spawn.x, getHeight(spawn.x, spawn.z) + EYE_HEIGHT + 1, spawn.z);
        }
        hud.setResults(null);
        hud.setPhase('playing');
        hud.setStatus('Partida em andamento.');
    }

    function showResults(payload) {
        phase = 'ended';
        if (controls.isLocked) controls.unlock();
        hud.setResults({ placements: payload.placements, scoreboard: payload.scoreboard });
        hud.setPhase('ended');
        hud.setStatus('Partida encerrada.');
    }

    function handleStartRequest() {
        if (!isHost) return;
        startMatch();
    }

    function handleRename(name) {
        const clean = (name || '').slice(0, 16) || myName;
        myName = clean;
        localVitals.label = clean;
        if (isHost) {
            const entry = roster.get('host');
            if (entry) entry.name = clean;
        } else {
            client?.send({ t: 'rename', name: clean });
        }
        try {
            localStorage.setItem('mundo3d-online-name', clean);
        } catch {
            /* noop */
        }
    }

    // ---------------------------------------------------------------
    // Combat
    // ---------------------------------------------------------------
    function onHit(target, arrow) {
        if (phase !== 'playing') return true;
        if (target.id === localId) {
            const before = localVitals.isDead;
            localVitals.damage(arrow.damage, 'arrow');
            lastArrowKillerId = arrow.ownerId;
            if (!before && localVitals.isDead) handleLocalDeath(arrow.ownerId);
            return true;
        }
        return true;
    }

    function handleLocalDeath(killerId) {
        if (deathHandled) return;
        deathHandled = true;
        if (isHost) {
            processDeath('host', killerId ?? null);
        } else {
            client?.send({ t: 'death', killerId: killerId ?? null });
        }
    }

    function createShot(level) {
        camera.getWorldDirection(shotDirection).normalize();
        camera.getWorldPosition(shotOrigin);
        shotOrigin.addScaledVector(shotDirection, BOW_CONFIG.distanciaSpawn ?? 0.85);
        return {
            ownerId: localId,
            origin: shotOrigin.clone(),
            direction: shotDirection.clone(),
            level
        };
    }

    function emitLocalShot(shot) {
        const msg = {
            t: 'shot',
            ownerId: shot.ownerId,
            ox: shot.origin.x,
            oy: shot.origin.y,
            oz: shot.origin.z,
            dx: shot.direction.x,
            dy: shot.direction.y,
            dz: shot.direction.z,
            level: shot.level
        };
        if (isHost) {
            host.broadcast(msg);
        } else {
            client?.send(msg);
        }
    }

    function queueRemoteShot(msg) {
        remoteShotQueue.push({
            ownerId: msg.ownerId,
            origin: new THREE.Vector3(msg.ox, msg.oy, msg.oz),
            direction: new THREE.Vector3(msg.dx, msg.dy, msg.dz),
            level: msg.level
        });
    }

    // ---------------------------------------------------------------
    // Input / lock
    // ---------------------------------------------------------------
    async function start() {
        if (isStarting || controls.isLocked) return;
        isStarting = true;
        try {
            controls.lock();
            const startResult = requestStart?.(player);
            if (startResult) await startResult;
        } finally {
            isStarting = false;
        }
    }

    function onLock() {
        hud.setLocked(true);
    }

    function onUnlock() {
        hud.setLocked(false);
    }

    function onKeyDown(event) {
        const key = mapKey(event);
        if (key) keys[key] = true;
    }

    function onKeyUp(event) {
        const key = mapKey(event);
        if (key) keys[key] = false;
    }

    function mapKey(event) {
        if (event.code === 'Space') return 'space';
        if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') return 'shift';
        if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.code === 'KeyC') return 'crouch';
        const lower = event.key.toLowerCase();
        if (lower === 'w' || lower === 'a' || lower === 's' || lower === 'd') return lower;
        return null;
    }

    function onMouseDown(event) {
        if (event.button !== 0 || !controls.isLocked) return;
        mouseShootHeld = true;
        event.preventDefault();
    }

    function onMouseUp(event) {
        if (event.button !== 0) return;
        mouseShootHeld = false;
    }

    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    // ---------------------------------------------------------------
    // Networking tick
    // ---------------------------------------------------------------
    function netTick(delta, isMoving, bowHud) {
        cameraEuler.setFromQuaternion(camera.quaternion);
        const isCrouching = controls.isLocked && !localVitals.isDead && keys.crouch;
        const myState = {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            yaw: cameraEuler.y,
            pitch: cameraEuler.x,
            isDead: localVitals.isDead,
            moving: isMoving,
            bow: bowHud ?? getBowHudState(bow),
            crouching: isCrouching
        };

        netAccum += delta;
        if (isHost) {
            const me = roster.get('host');
            if (me) me.lastState = myState;
            if (netAccum >= SEND_INTERVAL) {
                netAccum = 0;
                broadcastSnapshot();
            }
        } else if (localId) {
            if (netAccum >= SEND_INTERVAL) {
                netAccum = 0;
                client?.send({ t: 'state', state: myState });
            }
        }
    }

    // ---------------------------------------------------------------
    // Main update
    // ---------------------------------------------------------------
    function update(delta) {
        const shots = [];
        const locked = controls.isLocked;
        const canAct = locked && !localVitals.isDead;
        const isMoving = canAct && (keys.w || keys.a || keys.s || keys.d);
        const isCrouching = canAct && keys.crouch;

        updateDashInput(dash, canAct && !isCrouching && keys.shift && isMoving, canAct && isMoving);
        const speedMultiplier = updateDashState(dash, delta);
        localHitbox.height = isCrouching
            ? localHitbox.standingHeight * CROUCH_HITBOX_MULTIPLIER
            : localHitbox.standingHeight;

        let landing = null;
        if (canAct) {
            landing = updatePlayerPhysics({
                delta,
                position: player.position,
                state: localState,
                getHeight,
                getSample,
                jump: keys.space,
                crouching: isCrouching,
                movementSpeedMultiplier: speedMultiplier,
                resolveHorizontalCollision(position) {
                    resolveTreeCollision?.(position, HITBOX_RADIUS);
                },
                applyHorizontalMovement(distance) {
                    if (keys.w) controls.moveForward(distance);
                    if (keys.s) controls.moveForward(-distance);
                    if (keys.a) controls.moveRight(-distance);
                    if (keys.d) controls.moveRight(distance);
                }
            })?.landing ?? null;
        }

        if (locked) {
            localVitals.update(delta, player.position, getSample, landing);
        }

        if (phase === 'playing' && !wasDead && localVitals.isDead) {
            handleLocalDeath(lastArrowKillerId ?? null);
        }
        wasDead = localVitals.isDead;

        setBowHeld(bow, canAct && mouseShootHeld);
        const bowShot = updateBowState(bow, delta, canAct);
        if (bowShot) {
            const shot = createShot(bowShot.level);
            shots.push(shot);
            emitLocalShot(shot);
        }

        const bowHud = getBowHudState(bow);
        const dashHud = getDashHudState(dash);
        bowView.update(bowHud, locked && !localVitals.isDead);

        while (remoteShotQueue.length) {
            shots.push(remoteShotQueue.shift());
        }

        netTick(delta, isMoving, bowHud);
        updateRemotes(delta);

        const localPlayerInfo = {
            id: 'local',
            label: myName,
            position: player.position,
            yaw: cameraEuler.y,
            isCrouching,
            vitals: localVitals,
            bow: bowHud,
            dash: dashHud,
            hitbox: localHitbox
        };
        const arrowTargets = [
            { id: localId, position: player.position, hitbox: localHitbox, vitals: localVitals }
        ];
        const minimapPlayers = [localPlayerInfo];
        for (const entry of remotes.values()) {
            arrowTargets.push(entry.target);
            minimapPlayers.push({
                id: entry.target.id,
                label: entry.label ?? 'Jogador',
                position: entry.target.position,
                yaw: entry.group.rotation.y,
                isCrouching: entry.target.isCrouching,
                vitals: entry.target.vitals,
                color: entry.color
            });
        }

        return {
            isActive: locked,
            isMoving,
            primary: player.position,
            focuses: [player.position],
            players: [localPlayerInfo],
            minimapPlayers,
            arrowTargets,
            shots,
            onHit
        };
    }

    function render() {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(scene, camera);
    }

    function resize(width, height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function dispose() {
        controls.removeEventListener('lock', onLock);
        controls.removeEventListener('unlock', onUnlock);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        host?.destroy();
        client?.destroy();
        hud.dispose();
        bowView.dispose();
        for (const id of [...remotes.keys()]) removeRemote(id);
        scene.remove(player);
    }

    return {
        update,
        render,
        resize,
        dispose,
        get primaryCamera() {
            return camera;
        },
        get player() {
            return player;
        }
    };
}
