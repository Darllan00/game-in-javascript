import * as THREE from 'three';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _vector = new THREE.Vector3();

export const MAX_MOUSE_DELTA = 120;

export function clampMouseDelta(value) {
    if (!Number.isFinite(value)) return 0;
    return THREE.MathUtils.clamp(value, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
}

export class StablePointerLockControls extends THREE.EventDispatcher {
    constructor(camera, domElement = document.body) {
        super();

        this.camera = camera;
        this.domElement = domElement;
        this.isLocked = false;
        this.pointerSpeed = 1;

        this.minPolarAngle = 0;
        this.maxPolarAngle = Math.PI;

        this.object = new THREE.Object3D();
        this.object.add(camera);

        this._skipNextMouseMove = false;
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onPointerlockChange = this._onPointerlockChange.bind(this);
        this._onPointerlockError = this._onPointerlockError.bind(this);

        const ownerDocument = this.domElement.ownerDocument;
        ownerDocument.addEventListener('mousemove', this._onMouseMove);
        ownerDocument.addEventListener('pointerlockchange', this._onPointerlockChange);
        ownerDocument.addEventListener('pointerlockerror', this._onPointerlockError);
    }

    getObject() {
        return this.object;
    }

    lock() {
        this.domElement.requestPointerLock?.();
    }

    unlock() {
        this.domElement.ownerDocument.exitPointerLock?.();
    }

    disconnect() {
        const ownerDocument = this.domElement.ownerDocument;
        ownerDocument.removeEventListener('mousemove', this._onMouseMove);
        ownerDocument.removeEventListener('pointerlockchange', this._onPointerlockChange);
        ownerDocument.removeEventListener('pointerlockerror', this._onPointerlockError);
    }

    dispose() {
        this.disconnect();
    }

    moveForward(distance) {
        _vector.setFromMatrixColumn(this.camera.matrix, 0);
        _vector.crossVectors(this.camera.up, _vector);
        this.object.position.addScaledVector(_vector, distance);
        this.object.updateWorldMatrix(true, true);
    }

    moveRight(distance) {
        _vector.setFromMatrixColumn(this.camera.matrix, 0);
        this.object.position.addScaledVector(_vector, distance);
        this.object.updateWorldMatrix(true, true);
    }

    _onMouseMove(event) {
        if (!this.isLocked) return;
        if (this._skipNextMouseMove) {
            this._skipNextMouseMove = false;
            return;
        }

        const movementX = clampMouseDelta(event.movementX ?? event.mozMovementX ?? event.webkitMovementX ?? 0);
        const movementY = clampMouseDelta(event.movementY ?? event.mozMovementY ?? event.webkitMovementY ?? 0);

        _euler.setFromQuaternion(this.camera.quaternion);
        _euler.y -= movementX * 0.002 * this.pointerSpeed;
        _euler.x -= movementY * 0.002 * this.pointerSpeed;
        _euler.x = Math.max(
            Math.PI / 2 - this.maxPolarAngle,
            Math.min(Math.PI / 2 - this.minPolarAngle, _euler.x)
        );

        this.camera.quaternion.setFromEuler(_euler);
        this.dispatchEvent({ type: 'change' });
    }

    _onPointerlockChange() {
        const ownerDocument = this.domElement.ownerDocument;
        if (ownerDocument.pointerLockElement === this.domElement) {
            this.isLocked = true;
            this._skipNextMouseMove = true;
            this.dispatchEvent({ type: 'lock' });
        } else {
            this.isLocked = false;
            this.dispatchEvent({ type: 'unlock' });
        }
    }

    _onPointerlockError() {
        this.dispatchEvent({ type: 'unlock' });
    }
}
