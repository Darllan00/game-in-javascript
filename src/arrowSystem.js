import * as THREE from 'three';
import { CONFIG } from './config.js';

const ARROW_CONFIG = CONFIG.mecanicas?.arco ?? {};
const PLAYER_CONFIG = CONFIG.mecanicas?.jogador ?? {};
const ARROW_AXIS = new THREE.Vector3(0, 1, 0);
const directionScratch = new THREE.Vector3();
const segmentD1 = new THREE.Vector3();
const segmentD2 = new THREE.Vector3();
const segmentR = new THREE.Vector3();
const segmentClosest1 = new THREE.Vector3();
const segmentClosest2 = new THREE.Vector3();
const capsuleBottom = new THREE.Vector3();
const capsuleTop = new THREE.Vector3();
const terrainProbePosition = new THREE.Vector3();
const terrainImpactPosition = new THREE.Vector3();

function getLevelIndex(level) {
    const maxLevel = Math.max(1, ARROW_CONFIG.niveis ?? 4);
    return THREE.MathUtils.clamp(Math.floor(level ?? 1), 1, maxLevel) - 1;
}

function getLevelValue(values, level, fallback) {
    const index = getLevelIndex(level);
    return values?.[index] ?? values?.[values.length - 1] ?? fallback;
}

function createArrowMesh(resources) {
    const group = new THREE.Group();
    group.name = 'arrow';

    const shaft = new THREE.Mesh(resources.shaftGeometry, resources.shaftMaterial);
    shaft.position.y = -0.08;
    group.add(shaft);

    const tip = new THREE.Mesh(resources.tipGeometry, resources.tipMaterial);
    tip.position.y = 0.48;
    group.add(tip);

    const featherA = new THREE.Mesh(resources.featherGeometry, resources.featherMaterial);
    featherA.position.y = -0.48;
    featherA.rotation.z = Math.PI / 2;
    group.add(featherA);

    const featherB = new THREE.Mesh(resources.featherGeometry, resources.featherMaterial);
    featherB.position.y = -0.48;
    featherB.rotation.x = Math.PI / 2;
    featherB.rotation.z = Math.PI / 2;
    group.add(featherB);

    return group;
}

function orientArrow(mesh, velocity) {
    if (velocity.lengthSq() <= 0.0001) return;
    directionScratch.copy(velocity).normalize();
    mesh.quaternion.setFromUnitVectors(ARROW_AXIS, directionScratch);
}

function segmentSegmentDistanceSq(p1, q1, p2, q2) {
    const d1 = segmentD1.subVectors(q1, p1);
    const d2 = segmentD2.subVectors(q2, p2);
    const r = segmentR.subVectors(p1, p2);
    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);
    let s = 0;
    let t = 0;

    if (a <= 0.000001 && e <= 0.000001) {
        return p1.distanceToSquared(p2);
    }

    if (a <= 0.000001) {
        t = THREE.MathUtils.clamp(f / e, 0, 1);
    } else {
        const c = d1.dot(r);
        if (e <= 0.000001) {
            s = THREE.MathUtils.clamp(-c / a, 0, 1);
        } else {
            const b = d1.dot(d2);
            const denominator = a * e - b * b;
            if (denominator !== 0) {
                s = THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1);
            }
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0;
                s = THREE.MathUtils.clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1;
                s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
            }
        }
    }

    segmentClosest1.copy(p1).addScaledVector(d1, s);
    segmentClosest2.copy(p2).addScaledVector(d2, t);
    return segmentClosest1.distanceToSquared(segmentClosest2);
}

function arrowHitsPlayer(previousPosition, nextPosition, target, arrowRadius) {
    const targetPosition = target.position;
    if (!targetPosition) return false;

    const hitbox = target.hitbox ?? {};
    const radius = hitbox.radius ?? PLAYER_CONFIG.raioColisao ?? 0.55;
    const height = hitbox.height ?? PLAYER_CONFIG.alturaColisao ?? 2.0;
    const bottom = capsuleBottom.set(targetPosition.x, targetPosition.y - height, targetPosition.z);
    const top = capsuleTop.set(targetPosition.x, targetPosition.y, targetPosition.z);
    const hitRadius = radius + arrowRadius;

    return segmentSegmentDistanceSq(previousPosition, nextPosition, bottom, top) <= hitRadius * hitRadius;
}

function findTerrainImpact(previousPosition, nextPosition, getHeight, output) {
    const travelDistance = previousPosition.distanceTo(nextPosition);
    const probeCount = Math.min(12, Math.max(2, Math.ceil(travelDistance / 3)));

    for (let i = 1; i <= probeCount; i++) {
        const t = i / probeCount;
        terrainProbePosition.lerpVectors(previousPosition, nextPosition, t);
        const terrainHeight = getHeight(terrainProbePosition.x, terrainProbePosition.z);
        if (terrainProbePosition.y > terrainHeight + 0.04) continue;

        output.copy(terrainProbePosition);
        output.y = terrainHeight + 0.08;
        return true;
    }

    return false;
}

export function createArrowSystem(scene, getHeight, diagnostics = null, options = {}) {
    const findTrunkImpact = options.findTrunkImpact ?? null;
    const resources = {
        shaftGeometry: new THREE.CylinderGeometry(0.025, 0.025, 0.84, 6),
        tipGeometry: new THREE.ConeGeometry(0.075, 0.18, 8),
        featherGeometry: new THREE.BoxGeometry(0.18, 0.025, 0.055),
        shaftMaterial: new THREE.MeshStandardMaterial({ color: 0x5a341d, roughness: 0.82 }),
        tipMaterial: new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.55, metalness: 0.12 }),
        featherMaterial: new THREE.MeshStandardMaterial({ color: 0xd8d1c3, roughness: 0.9 })
    };
    const arrows = [];
    const meshPool = [];
    const arrowRecordPool = [];
    const gravity = ARROW_CONFIG.gravidade ?? 18;
    const lifeTime = ARROW_CONFIG.tempoVida ?? 8;
    const stuckLifeTime = ARROW_CONFIG.tempoCravadaNoTerreno ?? 24;
    const maxArrows = ARROW_CONFIG.maxFlechasAtivas ?? 64;
    const arrowRadius = ARROW_CONFIG.raioColisao ?? 0.18;

    function acquireArrowMesh() {
        const mesh = meshPool.pop() ?? createArrowMesh(resources);
        mesh.visible = true;
        return mesh;
    }

    function releaseArrowMesh(mesh) {
        if (!mesh) return;
        mesh.visible = false;
        mesh.parent?.remove(mesh);
        if (meshPool.length < maxArrows) {
            meshPool.push(mesh);
        }
    }

    function acquireArrowRecord() {
        return arrowRecordPool.pop() ?? {
            mesh: null,
            ownerId: null,
            velocity: new THREE.Vector3(),
            damage: 0,
            previousPosition: new THREE.Vector3(),
            stuck: false,
            stuckAge: 0,
            age: 0
        };
    }

    function releaseArrowRecord(arrow) {
        arrow.mesh = null;
        arrow.ownerId = null;
        arrow.velocity.set(0, 0, 0);
        arrow.damage = 0;
        arrow.previousPosition.set(0, 0, 0);
        arrow.stuck = false;
        arrow.stuckAge = 0;
        arrow.age = 0;
        if (arrowRecordPool.length < maxArrows) {
            arrowRecordPool.push(arrow);
        }
    }

    function removeArrow(arrow) {
        if (!arrow) return;
        releaseArrowMesh(arrow.mesh);
        releaseArrowRecord(arrow);
    }

    function shoot({ ownerId, origin, direction, level }) {
        if (!origin || !direction) return null;

        while (arrows.length >= maxArrows) {
            removeArrow(arrows.shift());
        }

        const speed = getLevelValue(ARROW_CONFIG.velocidades, level, 60);
        const damage = getLevelValue(ARROW_CONFIG.danos, level, 50);
        const mesh = acquireArrowMesh();

        mesh.position.copy(origin);
        scene.add(mesh);

        const arrow = acquireArrowRecord();
        arrow.mesh = mesh;
        arrow.ownerId = ownerId;
        arrow.velocity.copy(direction).normalize().multiplyScalar(speed);
        arrow.damage = damage;
        arrow.previousPosition.copy(mesh.position);
        arrow.stuck = false;
        arrow.stuckAge = 0;
        arrow.age = 0;

        orientArrow(mesh, arrow.velocity);

        arrows.push(arrow);
        diagnostics?.setCounter?.('arrows', arrows.length);
        return arrow;
    }

    function update(delta, targets = [], onHit = null) {
        const step = Math.min(delta, 0.05);
        for (let i = arrows.length - 1; i >= 0; i--) {
            const arrow = arrows[i];

            if (arrow.stuck) {
                arrow.stuckAge += step;
                if (arrow.stuckAge >= stuckLifeTime) {
                    removeArrow(arrow);
                    arrows.splice(i, 1);
                }
                continue;
            }

            arrow.previousPosition.copy(arrow.mesh.position);

            arrow.age += step;
            arrow.velocity.y -= gravity * step;
            arrow.mesh.position.addScaledVector(arrow.velocity, step);
            orientArrow(arrow.mesh, arrow.velocity);

            let shouldRemove = arrow.age >= lifeTime;

            if (!shouldRemove) {
                for (const target of targets) {
                    if (!target || target.id === arrow.ownerId || target.vitals?.isDead) continue;
                    if (!arrowHitsPlayer(arrow.previousPosition, arrow.mesh.position, target, arrowRadius)) continue;

                    if (onHit) {
                        const consumed = onHit(target, arrow) === true;
                        if (consumed) {
                            shouldRemove = true;
                            break;
                        }
                        continue;
                    }

                    target.vitals?.damage?.(arrow.damage, 'arrow');
                    shouldRemove = true;
                    break;
                }
            }

            if (!shouldRemove) {
                if (findTrunkImpact?.(arrow.previousPosition, arrow.mesh.position, arrowRadius, terrainImpactPosition)) {
                    arrow.mesh.position.copy(terrainImpactPosition);
                    arrow.velocity.set(0, 0, 0);
                    arrow.stuck = true;
                    arrow.stuckAge = 0;
                    continue;
                }
            }

            if (!shouldRemove) {
                if (findTerrainImpact(arrow.previousPosition, arrow.mesh.position, getHeight, terrainImpactPosition)) {
                    arrow.mesh.position.copy(terrainImpactPosition);
                    arrow.velocity.set(0, 0, 0);
                    arrow.stuck = true;
                    arrow.stuckAge = 0;
                    continue;
                }
            }

            if (shouldRemove) {
                removeArrow(arrow);
                arrows.splice(i, 1);
            }
        }
        diagnostics?.setCounter?.('arrows', arrows.length);
    }

    function dispose() {
        for (const arrow of arrows) {
            removeArrow(arrow);
        }
        arrows.length = 0;
        meshPool.length = 0;
        arrowRecordPool.length = 0;

        resources.shaftGeometry.dispose();
        resources.tipGeometry.dispose();
        resources.featherGeometry.dispose();
        resources.shaftMaterial.dispose();
        resources.tipMaterial.dispose();
        resources.featherMaterial.dispose();
    }

    return {
        shoot,
        update,
        dispose
    };
}
