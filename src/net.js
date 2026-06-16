import { Peer } from 'peerjs';

const ID_PREFIX = 'mundo3d-online-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 10;

export function generateRoomCode(length = 6) {
    let code = '';
    const random = globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint32Array(length))
        : null;
    for (let i = 0; i < length; i++) {
        const value = random ? random[i] : Math.floor(Math.random() * 0xffffffff);
        code += CODE_CHARS[value % CODE_CHARS.length];
    }
    return code;
}

export function roomCodeToPeerId(code) {
    return ID_PREFIX + String(code).toUpperCase();
}

function makePeer() {
    return new Peer({ debug: 1 });
}

export function createHost(code, handlers = {}) {
    const peer = new Peer(roomCodeToPeerId(code), { debug: 1 });
    const connections = new Map();

    peer.on('open', () => handlers.onReady?.(code));
    peer.on('error', (err) => handlers.onError?.(err));

    peer.on('connection', (conn) => {
        conn.on('open', () => {
            connections.set(conn.peer, conn);
            handlers.onConnect?.(conn);
        });
        conn.on('data', (data) => handlers.onData?.(conn, data));
        conn.on('close', () => {
            connections.delete(conn.peer);
            handlers.onDisconnect?.(conn);
        });
        conn.on('error', () => {
            connections.delete(conn.peer);
            handlers.onDisconnect?.(conn);
        });
    });

    function broadcast(message, exceptPeerId = null) {
        for (const conn of connections.values()) {
            if (!conn.open) continue;
            if (exceptPeerId && conn.peer === exceptPeerId) continue;
            conn.send(message);
        }
    }

    function sendTo(conn, message) {
        if (conn?.open) conn.send(message);
    }

    function destroy() {
        try {
            peer.destroy();
        } catch {
            /* noop */
        }
    }

    return { peer, connections, broadcast, sendTo, destroy };
}

export function createClient(code, handlers = {}) {
    const peer = makePeer();
    let conn = null;

    peer.on('open', () => {
        conn = peer.connect(roomCodeToPeerId(code), { reliable: true });
        conn.on('open', () => handlers.onOpen?.(conn));
        conn.on('data', (data) => handlers.onData?.(data));
        conn.on('close', () => handlers.onClose?.());
        conn.on('error', (err) => handlers.onError?.(err));
    });
    peer.on('error', (err) => handlers.onError?.(err));

    function send(message) {
        if (conn?.open) conn.send(message);
    }

    function destroy() {
        try {
            peer.destroy();
        } catch {
            /* noop */
        }
    }

    return {
        peer,
        get id() {
            return peer.id;
        },
        get conn() {
            return conn;
        },
        send,
        destroy
    };
}

export function fetchRoomSeed(code, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
        const peer = makePeer();
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                peer.destroy();
            } catch {
                /* noop */
            }
            fn(value);
        };

        const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs);

        peer.on('open', () => {
            const conn = peer.connect(roomCodeToPeerId(code), { reliable: true });
            conn.on('data', (data) => {
                if (data && data.t === 'welcome' && data.seed) {
                    finish(resolve, String(data.seed));
                }
            });
            conn.on('error', (err) => finish(reject, err));
        });
        peer.on('error', (err) => finish(reject, err));
    });
}
