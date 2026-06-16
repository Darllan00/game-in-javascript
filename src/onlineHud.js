function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function sortByScore(players) {
    return [...players].sort((a, b) => {
        if ((a.score ?? 0) !== (b.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
        if ((a.kills ?? 0) !== (b.kills ?? 0)) return (b.kills ?? 0) - (a.kills ?? 0);
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function placeLabel(place) {
    if (place === 1) return '1o';
    if (place === 2) return '2o';
    if (place === 3) return '3o';
    return `${place}o`;
}

export function createOnlineHud({
    isHost = false,
    code = '',
    onStart,
    onNewRound,
    onRename,
    onJoinWorld
} = {}) {
    const state = {
        phase: 'connecting',
        locked: false,
        canStart: false,
        roster: [],
        localId: null,
        results: null,
        status: '',
        code: String(code || '')
    };

    const root = el('div', 'online-hud');

    // ---- Lobby / pause panel ----
    const lobby = el('div', 'online-lobby');

    const title = el('h2', 'online-lobby-title', 'Sala Online');

    const codeRow = el('div', 'online-code-row');
    const codeLabel = el('span', 'online-code-label', 'Codigo da sala:');
    const codeValue = el('span', 'online-code-value', state.code);
    const copyButton = el('button', 'online-btn online-copy', 'Copiar');
    copyButton.type = 'button';
    copyButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(state.code);
            copyButton.textContent = 'Copiado';
            setTimeout(() => (copyButton.textContent = 'Copiar'), 1200);
        } catch {
            copyButton.textContent = state.code;
        }
    });
    codeRow.append(codeLabel, codeValue, copyButton);

    const nameRow = el('div', 'online-name-row');
    const nameLabel = el('label', 'online-name-label', 'Seu nome:');
    const nameInput = el('input', 'online-name-input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('change', () => onRename?.(nameInput.value.trim()));
    nameRow.append(nameLabel, nameInput);

    const rosterTitle = el('div', 'online-roster-title', 'Jogadores na sala');
    const rosterList = el('ul', 'online-roster');

    const statusLine = el('div', 'online-status', '');

    const actions = el('div', 'online-actions');
    const startButton = el('button', 'online-btn online-primary', 'Iniciar partida');
    startButton.type = 'button';
    startButton.addEventListener('click', (event) => {
        event.stopPropagation();
        onStart?.();
    });
    const waitText = el('div', 'online-wait', 'Aguardando o host iniciar a partida...');
    actions.append(startButton, waitText);

    const joinButton = el('button', 'online-btn online-join-world', 'Entrar no mundo');
    joinButton.type = 'button';
    joinButton.addEventListener('click', (event) => {
        event.stopPropagation();
        onJoinWorld?.();
    });

    const hint = el('div', 'online-hint', 'Mate os outros jogadores. A partida acaba quando restar 1 vivo.');

    lobby.append(title, codeRow, nameRow, rosterTitle, rosterList, actions, joinButton, statusLine, hint);

    // ---- Scoreboard (mini, top-right) ----
    const scoreboard = el('div', 'online-scoreboard');
    const scoreboardTitle = el('div', 'online-scoreboard-title', 'Placar');
    const scoreboardList = el('ul', 'online-scoreboard-list');
    scoreboard.append(scoreboardTitle, scoreboardList);

    // ---- Results panel ----
    const results = el('div', 'online-results');
    const resultsTitle = el('h2', 'online-results-title', 'Fim da partida');
    const placements = el('ol', 'online-placements');
    const finalBoardTitle = el('div', 'online-results-subtitle', 'Pontuacao da sala');
    const finalBoard = el('ul', 'online-scoreboard-list online-final-board');
    const resultsActions = el('div', 'online-actions');
    const newRoundButton = el('button', 'online-btn online-primary', 'Nova rodada');
    newRoundButton.type = 'button';
    newRoundButton.addEventListener('click', (event) => {
        event.stopPropagation();
        onNewRound?.();
    });
    const resultsWait = el('div', 'online-wait', 'Aguardando o host iniciar a proxima rodada...');
    resultsActions.append(newRoundButton, resultsWait);
    results.append(resultsTitle, placements, finalBoardTitle, finalBoard, resultsActions);

    root.append(lobby, scoreboard, results);
    document.body.appendChild(root);

    function renderRosterList(target, players, withPlace = false) {
        target.replaceChildren();
        const ordered = sortByScore(players);
        ordered.forEach((player) => {
            const item = el('li', 'online-roster-item');
            if (player.id === state.localId) item.classList.add('is-me');
            if (player.isDead) item.classList.add('is-dead');

            const name = el('span', 'online-roster-name', player.name || 'Jogador');
            const score = el('span', 'online-roster-score', `${player.score ?? 0} pts`);
            const kills = el('span', 'online-roster-kills', `${player.kills ?? 0} kills`);
            item.append(name, score, kills);
            target.appendChild(item);
        });
        if (!ordered.length) {
            target.appendChild(el('li', 'online-roster-empty', 'Ninguem ainda.'));
        }
    }

    function render() {
        const { phase, locked } = state;
        const showLobby = !locked && phase !== 'ended';
        const showResults = phase === 'ended';
        const showScore = phase === 'playing' || phase === 'ended';

        lobby.style.display = showLobby ? 'flex' : 'none';
        results.style.display = showResults ? 'flex' : 'none';
        scoreboard.style.display = showScore && !showResults ? 'block' : 'none';

        codeValue.textContent = state.code;
        statusLine.textContent = state.status || '';

        if (document.activeElement !== nameInput) {
            const me = state.roster.find((p) => p.id === state.localId);
            if (me && me.name != null && nameInput.value !== me.name) {
                nameInput.value = me.name;
            }
        }

        startButton.style.display = isHost ? 'inline-block' : 'none';
        waitText.style.display = isHost ? 'none' : 'block';
        startButton.disabled = !state.canStart;

        newRoundButton.style.display = isHost ? 'inline-block' : 'none';
        resultsWait.style.display = isHost ? 'none' : 'block';

        renderRosterList(rosterList, state.roster);
        renderRosterList(scoreboardList, state.roster);

        if (state.results) {
            placements.replaceChildren();
            state.results.placements.forEach((entry) => {
                const item = el('li', 'online-placement-item');
                if (entry.id === state.localId) item.classList.add('is-me');
                const label = el('span', 'online-placement-name',
                    `${placeLabel(entry.place)}  ${entry.name || 'Jogador'}`);
                const bonus = el('span', 'online-placement-bonus',
                    entry.bonus > 0 ? `+${entry.bonus}` : '');
                item.append(label, bonus);
                placements.appendChild(item);
            });
            renderRosterList(finalBoard, state.results.scoreboard);
        }
    }

    return {
        setPhase(phase) {
            state.phase = phase;
            render();
        },
        setLocked(locked) {
            state.locked = Boolean(locked);
            render();
        },
        setCanStart(canStart) {
            state.canStart = Boolean(canStart);
            render();
        },
        setStatus(text) {
            state.status = text || '';
            render();
        },
        setRoomCode(value) {
            state.code = String(value || '');
            render();
        },
        setRoster(players, localId) {
            state.roster = Array.isArray(players) ? players : [];
            if (localId != null) state.localId = localId;
            render();
        },
        setResults(data) {
            state.results = data;
            render();
        },
        dispose() {
            root.remove();
        }
    };
}
