import * as THREE from 'three';

const localOffset = new THREE.Vector3(0.5, -0.52, -1.14);
const rotationOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02, 0.1, -0.04));
const worldPosition = new THREE.Vector3();

function setLayerRecursive(object, layer) {
    object.layers.set(layer);
    for (const child of object.children) {
        setLayerRecursive(child, layer);
    }
}

function prepareViewMesh(mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    if (mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = 1;
        mesh.material.depthTest = false;
        mesh.material.depthWrite = false;
        mesh.material.toneMapped = false;
        mesh.material.needsUpdate = true;
    }
}

function createBowParts({ viewModel = false } = {}) {
    const group = new THREE.Group();
    group.name = viewModel ? 'bow-view' : 'bow-carried';
    group.frustumCulled = false;
    group.visible = false;
    group.scale.setScalar(viewModel ? 0.76 : 0.55);

    const materialType = viewModel ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
    const woodMaterial = new materialType({ color: 0x5b351c, roughness: 0.78, metalness: 0 });
    const gripMaterial = new materialType({ color: 0x21150f, roughness: 0.86, metalness: 0 });
    const stringMaterial = new materialType({ color: 0xd7d1c4, roughness: 0.72, metalness: 0 });
    const arrowMaterial = new materialType({ color: 0xcabf9a, roughness: 0.82, metalness: 0 });
    const tipMaterial = new materialType({ color: 0x2d3033, roughness: 0.55, metalness: 0.12 });

    const bowCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.0, -0.5, 0.0),
        new THREE.Vector3(-0.12, -0.25, 0.0),
        new THREE.Vector3(-0.06, 0.0, 0.0),
        new THREE.Vector3(-0.12, 0.25, 0.0),
        new THREE.Vector3(0.0, 0.5, 0.0)
    ]);
    const bowArc = new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 20, 0.018, 6), woodMaterial);
    if (viewModel) prepareViewMesh(bowArc);
    bowArc.castShadow = false;
    bowArc.receiveShadow = false;
    group.add(bowArc);

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 8), gripMaterial);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(-0.035, 0, 0.005);
    if (viewModel) prepareViewMesh(grip);
    grip.castShadow = false;
    grip.receiveShadow = false;
    group.add(grip);

    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.94, 5), stringMaterial);
    string.position.set(0.055, 0, 0.02);
    if (viewModel) prepareViewMesh(string);
    string.castShadow = false;
    string.receiveShadow = false;
    group.add(string);

    const arrow = new THREE.Group();
    arrow.name = viewModel ? 'bow-view-arrow' : 'bow-carried-arrow';
    arrow.visible = false;
    arrow.position.set(0.055, 0, -0.04);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.82, 5), arrowMaterial);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.18;
    if (viewModel) prepareViewMesh(shaft);
    shaft.castShadow = false;
    shaft.receiveShadow = false;
    arrow.add(shaft);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.075, 6), tipMaterial);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.61;
    if (viewModel) prepareViewMesh(tip);
    tip.castShadow = false;
    tip.receiveShadow = false;
    arrow.add(tip);

    group.add(arrow);

    return {
        group,
        string,
        arrow,
        materials: [woodMaterial, gripMaterial, stringMaterial, arrowMaterial, tipMaterial],
        geometries: [bowArc.geometry, grip.geometry, string.geometry, shaft.geometry, tip.geometry]
    };
}

export function createBowView(scene, camera, { layer = 0 } = {}) {
    const bow = createBowParts({ viewModel: true });
    setLayerRecursive(bow.group, layer);
    scene.add(bow.group);

    function update(bowState, isVisible) {
        bow.group.visible = Boolean(isVisible);
        if (!bow.group.visible) return;

        camera.updateWorldMatrix(true, false);
        worldPosition.copy(localOffset).applyMatrix4(camera.matrixWorld);
        bow.group.position.copy(worldPosition);
        bow.group.quaternion.copy(camera.quaternion).multiply(rotationOffset);

        const progress = bowState?.isCharging ? Math.max(0, Math.min(1, bowState.progress ?? 0)) : 0;
        bow.string.position.z = 0.02 + progress * 0.1;
        bow.arrow.visible = progress > 0.02;
        bow.arrow.position.z = -0.04 + progress * 0.08;
    }

    function dispose() {
        scene.remove(bow.group);
        for (const geometry of bow.geometries) {
            geometry.dispose();
        }
        for (const material of bow.materials) {
            material.dispose();
        }
    }

    return {
        update,
        dispose
    };
}

export function createCarriedBow({ layer = 0 } = {}) {
    const bow = createBowParts({ viewModel: false });
    bow.group.position.set(0.48, -0.9, -0.45);
    bow.group.rotation.set(0.12, -0.22, -0.16);
    setLayerRecursive(bow.group, layer);

    function update(bowState, isVisible) {
        bow.group.visible = Boolean(isVisible);
        const progress = bowState?.isCharging ? Math.max(0, Math.min(1, bowState.progress ?? 0)) : 0;
        bow.string.position.z = 0.02 + progress * 0.07;
        bow.arrow.visible = progress > 0.02;
        bow.arrow.position.z = -0.04 + progress * 0.06;
    }

    function dispose() {
        for (const geometry of bow.geometries) {
            geometry.dispose();
        }
        for (const material of bow.materials) {
            material.dispose();
        }
    }

    return {
        object: bow.group,
        update,
        dispose
    };
}
