"use strict";

/* =========================================================
   Project HR
   E: 인사팀 평가 / C: 문화 점수 / B: 예산 / O: 외부 여론
   T: 기술 경쟁력 / H: 실제 직원 분위기
========================================================= */

let C;
let EVENTS;
let TEXT;
let S;

const SAVE_KEY = "project-hr-save-v3";
const ENGINE_VERSION = 3;

const KEYS = ["E", "C", "B", "O", "T", "H"];
const EFFECT_KEYS = ["E", "C", "O", "T", "H"];

const SOURCES = {
    employee: "일반직원",
    executive: "경영진",
    developer: "개발팀",
    press: "언론"
};

const LABELS = {
    E: "인사팀 평가",
    C: "조직 문화 점수",
    B: "가용 예산",
    O: "외부 여론",
    T: "기술 경쟁력",
    H: "직원 분위기"
};

const ACTIONS = {
    accept: "수용",
    reject: "거부",
    defer: "보류"
};

const PACK_INDEX = {
    plain: 0,
    management: 1,
    culture: 2
};

const $ = id => document.getElementById(id);

const round = n =>
    Math.round((n + Number.EPSILON) * 10) / 10;

const esc = value => String(value).replace(
    /[&<>"']/g,
    ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[ch])
);

const DEV = typeof location !== "undefined"
    && new URLSearchParams(location.search).get("dev") === "1";

let storageAvailable = true;
let previewEnding = false;


/* =========================================================
   데이터 검사
========================================================= */

function validateData() {
    const requireValue = (ok, message) => {
        if (!ok) throw new Error(message);
    };

    const checkEffects = (effects, name) => {
        requireValue(
            effects
            && typeof effects === "object"
            && !Array.isArray(effects),
            `${name}: 효과 객체가 필요합니다.`
        );

        for (const [key, value] of Object.entries(effects)) {
            requireValue(
                EFFECT_KEYS.includes(key)
                && Number.isFinite(value),
                `${name}: ${key} 효과를 확인하세요. 예산은 cost로 지정합니다.`
            );
        }
    };

    requireValue(
        Number.isInteger(C.months) && C.months > 0,
        "config.months를 확인하세요."
    );

    for (const key of KEYS) {
        requireValue(
            Number.isFinite(C.limits?.[key])
            && C.limits[key] > 0,
            `${key} 상한을 확인하세요.`
        );

        requireValue(
            Number.isFinite(C.initial?.[key])
            && C.initial[key] >= 0
            && C.initial[key] <= C.limits[key],
            `${key} 초기값을 확인하세요.`
        );
    }

    for (const key of [
        "baseBudget",
        "budgetStep",
        "technologyDecay",
        "cultureFollow",
        "cultureWeight",
        "opinionWeight",
        "reputationBase",
        "target"
    ]) {
        requireValue(
            Number.isFinite(C.monthly?.[key]),
            `monthly.${key}를 확인하세요.`
        );
    }

    requireValue(
        C.monthly.budgetStep > 0,
        "budgetStep은 0보다 커야 합니다."
    );

    requireValue(
        C.requests?.weightDivisor > 0
        && Number.isInteger(C.requests.maxNew)
        && C.requests.maxNew > 0,
        "requests 설정을 확인하세요."
    );

    requireValue(
        Number.isInteger(C.requests.cooldown)
        && C.requests.cooldown >= 0,
        "cooldown을 확인하세요."
    );

    requireValue(
        Array.isArray(C.requests.levels)
        && C.requests.levels.length > 0,
        "요청 수 구간이 필요합니다."
    );

    C.requests.levels.sort((a, b) => a.min - b.min);

    for (const level of C.requests.levels) {
        requireValue(
            Number.isFinite(level.min)
            && Number.isInteger(level.count)
            && level.count > 0,
            "요청 수 구간을 확인하세요."
        );
    }

    requireValue(
        C.requests.levels[0].min === 0,
        "요청 수 구간은 min 0부터 시작해야 합니다."
    );

    requireValue(
        C.marketStay >= 0 && C.marketStay <= 1,
        "marketStay는 0~1이어야 합니다."
    );

    requireValue(
        Array.isArray(C.markets)
        && C.markets.length === 3
        && ["bad", "normal", "good"].every(
            (id, i) => C.markets[i].id === id
        ),
        "시황 순서는 bad, normal, good이어야 합니다."
    );

    for (const item of C.markets) {
        requireValue(
            Number.isFinite(item.budget)
            && Number.isFinite(item.morale),
            "시황 효과를 확인하세요."
        );
    }

    for (const source of Object.keys(SOURCES)) {
        checkEffects(
            C.sourceEffects?.[source],
            `sourceEffects.${source}`
        );

        checkEffects(
            C.rejectSourceEffects?.[source],
            `rejectSourceEffects.${source}`
        );

        checkEffects(
            C.deferEffects?.[source],
            `deferEffects.${source}`
        );
    }

    requireValue(
        Array.isArray(C.packages)
        && C.packages.length === 3
        && new Set(C.packages.map(pack => pack.id)).size === 3,
        "포장은 중복 없이 3개가 필요합니다."
    );

    for (const id of Object.keys(PACK_INDEX)) {
        const pack = C.packages.find(item => item.id === id);

        requireValue(
            pack
            && Number.isFinite(pack.cost)
            && pack.cost >= 0,
            `${id} 포장 비용을 확인하세요.`
        );

        checkEffects(pack.effects, `${id} 포장`);
    }

    requireValue(
        Array.isArray(EVENTS) && EVENTS.length > 0,
        "events.json에 사건이 필요합니다."
    );

    requireValue(
        new Set(EVENTS.map(event => event.id)).size === EVENTS.length,
        "중복된 사건 ID가 있습니다."
    );

    for (const event of EVENTS) {
        requireValue(
            typeof event.id === "string"
            && /^[a-z][a-z0-9_]*$/.test(event.id),
            "사건 ID는 영문 소문자·숫자·밑줄로 작성하세요."
        );

        requireValue(
            Object.hasOwn(SOURCES, event.source),
            `${event.id}: 주체를 확인하세요.`
        );

        requireValue(
            typeof event.title === "string"
            && typeof event.body === "string",
            `${event.id}: 제목과 본문이 필요합니다.`
        );

        requireValue(
            Number.isFinite(event.cost),
            `${event.id}: cost를 확인하세요.`
        );

        for (const action of ["accept", "reject"]) {
            checkEffects(
                event.effects?.[action],
                `${event.id}.${action}`
            );

            requireValue(
                Array.isArray(event.responses?.[action])
                && event.responses[action].length === 3
                && event.responses[action].every(
                    text => typeof text === "string" && text.trim()
                ),
                `${event.id}.${action}: 대사 3개가 필요합니다.`
            );
        }
    }

    for (const key of ["H", "T"]) {
        requireValue(
            Array.isArray(TEXT.signs?.[key])
            && TEXT.signs[key].length > 0,
            `${key} 징조가 필요합니다.`
        );

        TEXT.signs[key].sort((a, b) => a.min - b.min);

        requireValue(
            TEXT.signs[key][0].min === 0,
            `${key} 징조는 min 0부터 시작해야 합니다.`
        );

        for (const band of TEXT.signs[key]) {
            requireValue(
                Number.isFinite(band.min)
                && Array.isArray(band.texts)
                && band.texts.length > 0
                && band.texts.every(
                    text => typeof text === "string"
                ),
                `${key} 징조 구간을 확인하세요.`
            );

            requireValue(
                ["bad", "normal", "good"].every(
                    id => typeof band.market?.[id] === "string"
                ),
                `${key} 시황별 징조를 확인하세요.`
            );
        }
    }

    requireValue(
        Array.isArray(TEXT.gap?.levels) &&
        TEXT.gap.levels.length > 0,
        "gap.levels에 격차 구간이 필요합니다."
    );

    for (const level of TEXT.gap.levels) {
        requireValue(
            Number.isFinite(level.min) &&
            level.min >= 0 &&
            Array.isArray(level.texts) &&
            level.texts.length > 0 &&
            level.texts.every(
                text => typeof text === "string" && text.trim()
            ),
            "gap 구간의 min과 texts를 확인하세요."
        );
    }

    TEXT.gap.levels.sort((a, b) => a.min - b.min);

    requireValue(
        new Set(TEXT.gap.levels.map(level => level.min)).size ===
        TEXT.gap.levels.length,
        "gap 구간의 min이 중복됐습니다."
    );

    for (const key of ["E", "C", "B", "O", "market"]) {
        requireValue(
            typeof C.help?.[key]?.text === "string",
            `${key} 도움말을 확인하세요.`
        );
    }
}


/* =========================================================
   기본 계산
========================================================= */

function rng() {
    S.rng = (
        Math.imul(S.rng, 1664525) + 1013904223
    ) >>> 0;

    return S.rng / 4294967296;
}

function pick(items) {
    return items[Math.floor(rng() * items.length)];
}

function eventById(id) {
    return EVENTS.find(event => event.id === id);
}

function packById(id) {
    return C.packages.find(pack => pack.id === id);
}

function market() {
    return C.markets.find(item => item.id === S.market);
}

function add(target, effects) {
    for (const [key, value] of Object.entries(effects)) {
        target[key] = (target[key] || 0) + value;
    }

    return target;
}

function apply(effects) {
    for (const [key, value] of Object.entries(effects)) {
        S.stats[key] = round(
            Math.max(
                0,
                Math.min(
                    C.limits[key],
                    S.stats[key] + value
                )
            )
        );
    }
}

function effectsFor(event, action, packId = null) {
    // 보류는 요청 주체별 불이익만 적용합니다.
    if (action === "defer") {
        return { ...C.deferEffects[event.source] };
    }

    const effects = {};

    // 요청 주체에 따른 공통 효과
    add(
        effects,
        action === "accept"
            ? C.sourceEffects[event.source]
            : C.rejectSourceEffects[event.source]
    );

    // 사건 자체의 효과
    add(effects, event.effects[action]);

    if (packId) {
        const pack = packById(packId);

        // 문화 홍보: E·H의 상승과 하락 폭을 모두 30% 줄입니다.
        for (const [key, multiplier] of Object.entries(
            pack.effectMultipliers ?? {}
        )) {
            if (Object.hasOwn(effects, key)) {
                effects[key] *= multiplier;
            }
        }

        // 선택한 설명 방식의 고정 효과
        add(effects, pack.effects);
    }

    // 미리보기와 실제 정산에서 같은 소수점 정밀도를 사용합니다.
    return Object.fromEntries(
        Object.entries(effects).map(([key, value]) => [
            key,
            round(value)
        ])
    );
}

function isComplete(selection) {
    return !!selection && (
        selection.action === "defer"
        || !!selection.pack
    );
}

function canDefer(item) {
    return !item.returning && S.month < C.months;
}


/* =========================================================
   예산과 선택
========================================================= */

function budget(selections = S.selections) {
    let income = 0;
    let spending = 0;

    for (const [id, selected] of Object.entries(selections)) {
        if (selected.action === "defer") continue;

        const base = selected.action === "accept"
            ? eventById(id).cost
            : 0;

        if (base < 0) {
            income -= base;
        } else {
            spending += base;
        }

        if (selected.pack) {
            spending += packById(selected.pack).cost;
        }
    }

    // 확보액에 보유 한도를 적용한 뒤 지출합니다.
    const usable = Math.min(
        C.limits.B,
        S.stats.B + income
    );

    return {
        income,
        spending,
        usable,
        remaining: round(usable - spending),
        lost: round(S.stats.B + income - usable)
    };
}

function canChoose(id, action, pack = null) {
    const item = S.queue.find(entry => entry.id === id);

    if (
        !item
        || S.ended
        || !Object.hasOwn(ACTIONS, action)
    ) {
        return false;
    }

    if (action === "defer" && !canDefer(item)) {
        return false;
    }

    if (pack && !packById(pack)) {
        return false;
    }

    const candidate = {
        ...S.selections,
        [id]: {
            action,
            pack: action === "defer" ? null : pack
        }
    };

    return budget(candidate).remaining >= 0;
}

function canClear(id) {
    const next = { ...S.selections };

    delete next[id];

    return budget(next).remaining >= 0;
}

function planComplete() {
    return !S.ended
        && S.queue.length > 0
        && S.queue.every(item => {
            const selected = S.selections[item.id];

            return isComplete(selected)
                && canChoose(
                    item.id,
                    selected.action,
                    selected.pack
                );
        })
        && budget().remaining >= 0;
}

function grant() {
    return Math.max(
        0,
        round(
            C.monthly.baseBudget
            + Math.floor(S.stats.E / C.monthly.budgetStep)
            + Math.floor(S.stats.T / C.monthly.budgetStep)
            + market().budget
        )
    );
}


/* =========================================================
   요청 생성
========================================================= */

function sourceWeights() {
    const metrics = {
        employee: "H",
        executive: "E",
        developer: "T",
        press: "O"
    };

    return Object.fromEntries(
        Object.entries(metrics).map(([source, key]) => [
            source,
            1 + (
                C.limits[key] - S.stats[key]
            ) / C.requests.weightDivisor
        ])
    );
}

function weighted(items) {
    let draw = rng() * items.reduce(
        (sum, item) => sum + item.weight,
        0
    );

    for (const item of items) {
        draw -= item.weight;

        if (draw < 0) return item.source;
    }

    return items[items.length - 1].source;
}

function makeQueue(pending) {
    S.queue = [...pending];

    const level = [...C.requests.levels]
        .reverse()
        .find(item => S.stats.H >= item.min);

    const count = Math.min(
        level.count,
        C.requests.maxNew
    );

    const weights = sourceWeights();

    for (let i = 0; i < count; i++) {
        const available = EVENTS.filter(event => {
            const queued = S.queue.some(
                item => item.id === event.id
            );

            const last = S.lastResolved[event.id];

            return !queued && (
                last === undefined
                || S.month - last > C.requests.cooldown
            );
        });

        const sources = Object.keys(SOURCES)
            .filter(source => available.some(
                event => event.source === source
            ))
            .map(source => ({
                source,
                weight: weights[source]
            }));

        if (!sources.length) break;

        const source = weighted(sources);

        const event = pick(
            available.filter(item => item.source === source)
        );

        S.queue.push({
            id: event.id,
            returning: false
        });
    }
}


/* =========================================================
   시황과 사내 동향
========================================================= */

function changeMarket() {
    if (rng() < C.marketStay) return;

    const index = C.markets.findIndex(
        item => item.id === S.market
    );

    const next = [index - 1, index + 1].filter(
        i => i >= 0 && i < C.markets.length
    );

    S.market = C.markets[pick(next)].id;
}

function updateSigns() {
    S.signs = [];

    // 실제 직원 분위기와 기술 경쟁력 징조
    for (const key of ["H", "T"]) {
        const band = [...TEXT.signs[key]]
            .reverse()
            .find(item => S.stats[key] >= item.min);

        const choices = band.texts.filter(
            text => text !== S.lastSigns[key]
        );

        const line = pick(
            choices.length ? choices : band.texts
        );

        S.lastSigns[key] = line;
        S.signs.push(`${line} ${band.market[S.market]}`);
    }

    // 공식 문화 점수가 실제 직원 분위기보다 높은 정도
    const gap = S.stats.C - S.stats.H;

    const gapBand = [...TEXT.gap.levels]
        .reverse()
        .find(level => gap >= level.min);

    if (gapBand) {
        const choices = gapBand.texts.filter(
            text => text !== S.lastSigns.gap
        );

        const line = pick(
            choices.length ? choices : gapBand.texts
        );

        S.lastSigns.gap = line;
        S.signs.push(line);
    }
}


/* =========================================================
   저장
========================================================= */

function persist() {
    try {
        localStorage.setItem(
            SAVE_KEY,
            JSON.stringify({
                engine: ENGINE_VERSION,
                config: C.version,
                state: S
            })
        );
    } catch (_) {
        storageAvailable = false;
    }
}

function loadSaved() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(SAVE_KEY)
        );

        if (
            saved?.engine !== ENGINE_VERSION
            || saved.config !== C.version
        ) {
            return null;
        }

        const state = saved.state;

        if (
            !state
            || !Array.isArray(state.history)
            || !state.history.length
        ) {
            return null;
        }

        if (
            !Number.isInteger(state.month)
            || state.month < 1
            || state.month > C.months
        ) {
            return null;
        }

        if (!KEYS.every(key => (
            Number.isFinite(state.stats?.[key])
            && state.stats[key] >= 0
            && state.stats[key] <= C.limits[key]
        ))) {
            return null;
        }

        if (
            !Array.isArray(state.queue)
            || !state.queue.every(item => eventById(item.id))
        ) {
            return null;
        }

        if (
            !state.selections
            || !state.lastResolved
            || !state.lastSigns
            || !Array.isArray(state.signs)
        ) {
            return null;
        }

        if (!C.markets.some(
            item => item.id === state.market
        )) {
            return null;
        }

        for (
            const [id, selected]
            of Object.entries(state.selections)
        ) {
            const item = state.queue.find(
                entry => entry.id === id
            );

            if (
                !item
                || !Object.hasOwn(ACTIONS, selected.action)
            ) {
                return null;
            }

            if (selected.action === "defer") {
                if (
                    selected.pack
                    || item.returning
                    || state.month === C.months
                ) {
                    return null;
                }
            } else if (
                selected.pack
                && !packById(selected.pack)
            ) {
                return null;
            }
        }

        if (!state.history.every((point, i) => (
            point.month === i
            && KEYS.every(
                key => Number.isFinite(point.stats?.[key])
            )
        ))) {
            return null;
        }

        return state;

    } catch (_) {
        return null;
    }
}


/* =========================================================
   게임 진행
========================================================= */

function newGame() {
    previewEnding = false;

    S = {
        month: 1,
        rng: (Date.now() >>> 0) || 1,
        stats: { ...C.initial },
        market: "normal",

        queue: [],
        selections: {},
        lastResolved: {},
        lastSigns: {},
        signs: [],

        ended: false,
        previousStats: null,

        history: [
            {
                month: 0,
                stats: { ...C.initial }
            }
        ],

        summary: "인사팀장 부임 첫 달입니다."
    };

    makeQueue([]);
    updateSigns();
    persist();
    render();
}

function finishMonth() {
    if (!planComplete()) return;

    previewEnding = false;

    const before = { ...S.stats };
    const closedMonth = S.month;
    const account = budget();

    const changes = {};
    const pending = [];

    const counts = {
        accept: 0,
        reject: 0,
        defer: 0
    };

    for (const item of S.queue) {
        const selected = S.selections[item.id];

        add(
            changes,
            effectsFor(
                eventById(item.id),
                selected.action,
                selected.pack
            )
        );

        counts[selected.action]++;

        if (selected.action === "defer") {
            pending.push({
                id: item.id,
                returning: true
            });
        } else {
            S.lastResolved[item.id] = S.month;
        }
    }

    // 선택 효과를 합산한 후 한 번에 반영합니다.
    apply(changes);
    S.stats.B = account.remaining;

    const dismissedByAction = S.stats.E <= 0;
    const oldMarket = market().label;

    apply({
        T: -C.monthly.technologyDecay
    });

    apply({
        H: market().morale
    });

    apply({
        C: C.monthly.cultureFollow
            * (S.stats.H - S.stats.C)
    });

    if (!dismissedByAction) {
        apply({
            E: C.monthly.reputationBase
                + C.monthly.cultureWeight
                * (S.stats.C - C.monthly.target)
                + C.monthly.opinionWeight
                * (S.stats.O - C.monthly.target)
        });
    }

    S.ended =
        S.stats.E <= 0
        || S.month === C.months;

    S.ending = S.stats.E <= 0
        ? "dismissed"
        : "survived";

    if (!S.ended) {
        S.month++;

        changeMarket();

        S.stats.B = round(
            Math.min(
                C.limits.B,
                S.stats.B + grant()
            )
        );

        makeQueue(pending);
    }

    /*
       공개 지표의 증감은 이전 대시보드와 비교합니다.
       예산에는 다음 달 배정까지 포함됩니다.
    */
    S.previousStats = before;

    /*
       숨은 지표는 방금 끝난 달의 결산값입니다.
       부임 시점은 0, 이후 1~12월을 기록합니다.
    */
    S.history.push({
        month: closedMonth,
        stats: { ...S.stats }
    });

    S.summary =
        `${closedMonth}월 처리: `
        + `수용 ${counts.accept} · `
        + `거부 ${counts.reject} · `
        + `보류 ${counts.defer}`;

    if (S.ended) {
        S.marketNote =
            `${oldMarket} 시황으로 업무를 마쳤습니다.`;
    } else {
        const changeText = oldMarket === market().label
            ? `${market().label} 시황이 이어집니다.`
            : `${oldMarket}에서 ${market().label}으로 바뀌었습니다.`;

        S.marketNote =
            `${changeText} ${market().description}`;
    }

    S.selections = {};

    updateSigns();
    persist();
    render();

    window.scrollTo({
        top: 0,
        behavior: window.matchMedia?.(
            "(prefers-reduced-motion: reduce)"
        )?.matches ? "auto" : "smooth"
    });
}


/* =========================================================
   선택지 표시
========================================================= */

function responseText(event, action, packId) {
    const lines = event.responses[action];
    const index = PACK_INDEX[packId];

    return index === 0
        ? lines[0]
        : `${lines[0]} ${lines[index]}`;
}

function arrowHTML(effects) {
    // [화살표 1개 상한, 화살표 2개 상한]
    const thresholds = {
        E: [2, 5], // 인사팀 평판
        H: [3, 7], // 실제 직원 분위기
        T: [3, 6], // 기술 경쟁력
        C: [2, 5], // 조직 문화 점수
        O: [2, 5]  // 외부 여론
    };

    return EFFECT_KEYS
        .filter(key => (
            Number.isFinite(effects[key])
            && effects[key] !== 0
        ))
        .map(key => {
            const value = effects[key];
            const amount = Math.abs(value);

            const [small, medium] = thresholds[key];

            const strength =
                amount <= small ? 1
                    : amount <= medium ? 2
                        : 3;

            const increasing = value > 0;

            const arrows = (
                increasing ? "↑" : "↓"
            ).repeat(strength);

            const description =
                ["", "소폭", "중간", "큰 폭"][strength]
                + (increasing ? " 상승" : " 하락");

            return `
                <span class="effect ${increasing ? "is-up" : "is-down"
                }">
                    ${LABELS[key]}

                    <span
                        class="effect-arrows"
                        aria-label="${description}"
                    >${arrows}</span>
                </span>
            `;
        })
        .join("")
        || '<span class="muted">직접 변화 없음</span>';
}

function baseCostLabel(event, action) {
    if (action !== "accept") return "기본 비용 0";

    return event.cost < 0
        ? `예산 ${-event.cost} 확보`
        : `기본 비용 ${event.cost}`;
}

function cardHTML(item, index) {
    const event = eventById(item.id);
    const selected = S.selections[item.id];

    const actionButtons = Object.entries(ACTIONS)
        .map(([action, label]) => {
            const locked =
                action === "defer" && !canDefer(item);

            const allowed =
                !locked && canChoose(item.id, action);

            const reason = locked
                ? (
                    item.returning
                        ? "재보류 불가"
                        : "마지막 달"
                )
                : !allowed
                    ? "예산 부족 · 다른 선택 조정 필요"
                    : baseCostLabel(event, action);

            return `
                <button
                    class="action ${selected?.action === action
                    ? "selected"
                    : ""
                }"
                    data-event="${event.id}"
                    data-action="${action}"
                    ${allowed ? "" : "disabled"}
                    aria-pressed="${selected?.action === action
                }"
                >
                    ${label}
                    <small>${reason}</small>
                </button>
            `;
        })
        .join("");

    let detail = "";

    if (selected?.action === "defer") {
        detail = `
            <div class="packages">
                <strong>
                    다음 달에 다시 검토합니다.
                </strong>

                <p class="body-copy">
                    이번 달 비용은 없습니다.
                    다만 답변 지연에 따른 요청 항목 관련
                    작은 불이익이 발생합니다.
                </p>

                <div class="effects">
                    ${arrowHTML(effectsFor(event, "defer"))}
                </div>
            </div>
        `;

    } else if (selected) {
        const options = C.packages.map(pack => {
            const allowed = canChoose(
                item.id,
                selected.action,
                pack.id
            );

            const base = selected.action === "accept"
                ? event.cost
                : 0;

            const costLabel = base < 0
                ? `확보 ${-base} · 비용 ${pack.cost}`
                : `총비용 ${base + pack.cost}`;

            return `
                <button
                    class="package ${selected.pack === pack.id
                    ? "selected"
                    : ""
                }"
                    data-event="${event.id}"
                    data-pack="${pack.id}"
                    ${allowed ? "" : "disabled"}
                    aria-pressed="${selected.pack === pack.id
                }"
                >
                    <span class="package-top">
                        <strong>${esc(pack.label)}</strong>
                        <b>${costLabel}</b>
                    </span>

                    <span class="quote">
                        ${esc(
                    responseText(
                        event,
                        selected.action,
                        pack.id
                    )
                )}
                    </span>

                    <span class="effects">
                        ${arrowHTML(
                    effectsFor(
                        event,
                        selected.action,
                        pack.id
                    )
                )}
                    </span>

                    <small>
                        포장 추가 비용 ${pack.cost}
                        ${allowed ? "" : " · 예산 부족"}
                    </small>
                </button>
            `;
        }).join("");

        detail = `
            <div class="packages">
                <p class="eyebrow">
                    02 / 어떻게 설명하시겠습니까?
                </p>
                ${options}
            </div>
        `;
    }

    const completed = isComplete(selected);

    const badge = item.returning
        ? "재상정 · 이번 달 결정 필수"
        + (completed ? " · 작성 완료" : "")
        : completed
            ? (
                selected.action === "defer"
                    ? "보류 선택 완료"
                    : "대응 작성 완료"
            )
            : "신규 요청";

    const body = item.returning
        ? (
            event.returnBody
            || "지난달 보류한 요청입니다. "
            + "이번 달에는 수용 또는 거부를 결정해야 합니다. "
            + event.body
        )
        : event.body;

    const clear = selected
        ? `
            <button
                class="text-button"
                data-event="${event.id}"
                data-clear="1"
                ${canClear(item.id)
            ? ""
            : 'disabled title="확보한 예산을 사용 중입니다. 다른 카드의 비용부터 줄이세요."'
        }
            >선택 해제</button>
        `
        : "";

    return `
        <article class="event-card ${completed ? "complete" : ""
        }">
            <div class="card-meta">
                <span>
                    ${String(index + 1).padStart(2, "0")}
                    / ${SOURCES[event.source]}
                </span>
                <span>${badge}</span>
            </div>

            <h3>${esc(event.title)}</h3>
            <p class="body-copy">${esc(body)}</p>

            <p class="eyebrow">01 / 실제 조치</p>

            <div class="actions">
                ${actionButtons}
            </div>

            ${detail}
            ${clear}
        </article>
    `;
}


/* =========================================================
   대시보드 증감 표시
========================================================= */

function trendHTML(key) {
    if (!S.previousStats) return "";

    const difference = round(
        S.stats[key] - S.previousStats[key]
    );

    const type = difference > 0
        ? "up"
        : difference < 0 ? "down" : "flat";

    const text = difference > 0
        ? "상승"
        : difference < 0 ? "하락" : "변화 없음";

    return `
        <span
            class="stat-trend is-${type}"
            title="전월 대비 ${text}"
            aria-label="전월 대비 ${text}"
        >${difference > 0
            ? "↑"
            : difference < 0 ? "↓" : "—"
        }</span>
    `;
}


/* =========================================================
   엔딩 그래프
========================================================= */

function renderChart() {
    const points = S.history;
    const host = $("ending-chart");

    const width = Math.max(
        360,
        Math.min(
            900,
            host.clientWidth - 24 || 640
        )
    );

    const height = 280;
    const left = 40;
    const right = 22;
    const top = 20;
    const bottom = 40;

    const innerW = width - left - right;
    const innerH = height - top - bottom;

    const lastMonth = points[points.length - 1].month;

    const maximum = Math.max(
        C.limits.T,
        C.limits.H
    );

    const x = month => lastMonth
        ? left + innerW * month / lastMonth
        : left + innerW / 2;

    const y = value =>
        top + innerH * (1 - value / maximum);

    const ticks = Array.from(
        { length: 5 },
        (_, i) => maximum * i / 4
    );

    const grid = ticks.map(value => `
        <line
            class="chart-grid"
            x1="${left}"
            y1="${y(value)}"
            x2="${width - right}"
            y2="${y(value)}"
        />

        <text
            class="chart-label"
            x="${left - 9}"
            y="${y(value) + 4}"
            text-anchor="end"
        >${round(value)}</text>
    `).join("");

    const step = Math.max(
        1,
        Math.ceil(
            lastMonth / (width < 500 ? 4 : 8)
        )
    );

    const months = points.filter(point =>
        point.month === 0
        || point.month === lastMonth
        || point.month % step === 0
    );

    const labels = months.map(point => `
        <text
            class="chart-label"
            x="${x(point.month)}"
            y="${height - 13}"
            text-anchor="middle"
        >${point.month === 0
            ? "부임"
            : point.month + "월"
        }</text>
    `).join("");

    const lines = ["T", "H"].map(key => {
        const suffix = key.toLowerCase();

        const coordinates = points.map(point =>
            `${x(point.month)},${y(point.stats[key])}`
        ).join(" ");

        const dots = points.map(point => `
            <circle
                class="chart-point chart-point-${suffix}"
                cx="${x(point.month)}"
                cy="${y(point.stats[key])}"
                r="3.5"
            >
                <title>${point.month === 0
                ? "부임"
                : point.month + "월"
            } ${LABELS[key]} ${point.stats[key]}</title>
            </circle>
        `).join("");

        return `
            <polyline
                class="chart-line chart-line-${suffix}"
                points="${coordinates}"
            />
            ${dots}
        `;
    }).join("");

    host.innerHTML = `
        <svg
            viewBox="0 0 ${width} ${height}"
            role="img"
            aria-label="부임부터 ${lastMonth}월 결산까지 기술 경쟁력과 실제 직원 분위기"
        >
            <title>
                기술 경쟁력과 실제 직원 분위기
            </title>

            ${grid}

            <line
                class="chart-axis"
                x1="${left}"
                y1="${top + innerH}"
                x2="${width - right}"
                y2="${top + innerH}"
            />

            ${labels}
            ${lines}
        </svg>
    `;

    for (const key of ["T", "H"]) {
        const prefix = `ending-${key.toLowerCase()}`;

        $(`${prefix}-start`).textContent =
            points[0].stats[key];

        $(`${prefix}-end`).textContent =
            points[points.length - 1].stats[key];
    }
}

function renderEnding() {
    const visible =
        S.ended || (DEV && previewEnding);

    $("ending").hidden = !visible;

    if (!visible) return;

    $("ending-title").textContent = S.ended
        ? (
            S.ending === "dismissed"
                ? "인사팀장 교체 안내"
                : `${C.months}개월 업무를 마쳤습니다`
        )
        : "회사 상태 미리보기";

    $("ending-copy").textContent = S.ended
        ? (
            S.ending === "dismissed"
                ? "경영진의 결정으로 임기를 마쳤습니다. "
                + "재직 기간 동안 회사가 어떻게 달라졌는지 확인하세요."
                : "올해 인사팀 업무가 끝났습니다. "
                + "공개 지표 뒤에 있던 회사의 상태도 확인하세요."
        )
        : "확정된 월별 기록만 표시합니다. "
        + "게임 진행과 저장 내용은 바뀌지 않습니다.";

    renderChart();
}


/* =========================================================
   화면 갱신
========================================================= */

function render() {
    const active = document.activeElement;

    const focusData = active?.dataset?.event
        ? { ...active.dataset }
        : null;

    $("intro").hidden = true;
    $("game").hidden = false;

    $("month-label").textContent =
        `${String(S.month).padStart(2, "0")} / ${C.months}월`;

    $("stats").innerHTML = ["E", "C", "B", "O"]
        .map(key => `
            <div class="stat">
                <div>
                    ${LABELS[key]}

                    <button
                        class="help"
                        data-help="${key}"
                        aria-label="${LABELS[key]} 설명"
                    >?</button>
                </div>

                <strong>
                    ${S.stats[key]}
                    <small> / ${C.limits[key]}</small>
                    ${trendHTML(key)}
                </strong>
            </div>
        `)
        .join("")
        + `
            <div class="stat market">
                <div>
                    업계 시황

                    <button
                        class="help"
                        data-help="market"
                        aria-label="시황 설명"
                    >?</button>
                </div>

                <strong>${market().label}</strong>
            </div>
        `;

    $("briefing-summary").textContent = S.summary;

    // 기존 HTML의 숫자 해설 목록은 사용하지 않습니다.
    $("briefing-list").hidden = true;
    $("briefing-list").replaceChildren();

    $("market-note").textContent =
        S.marketNote || market().description;

    $("signs").innerHTML = S.signs
        .map(text => `<p>${esc(text)}</p>`)
        .join("");

    $("events").innerHTML = S.ended
        ? ""
        : S.queue.map(cardHTML).join("");

    const completed = S.queue.filter(
        item => isComplete(S.selections[item.id])
    ).length;

    $("progress").textContent = S.ended
        ? "업무 종료"
        : `대응 작성 ${completed} / ${S.queue.length}`;

    const account = budget();

    $("budget-plan").textContent =
        `현재 ${S.stats.B}`
        + ` · 절감 확보 ${account.income}`
        + ` · 선택 비용 ${account.spending}`
        + ` · 잔액 ${account.remaining}`
        + (
            account.lost
                ? ` · 한도 초과 ${account.lost}`
                : ""
        );

    $("next-month").disabled = !planComplete();

    $("next-month").textContent =
        S.month === C.months
            ? "연간 결산 확정"
            : "대응 확정 · 다음 달";

    $("month-controls").hidden = S.ended;

    renderEnding();

    $("dev-controls").hidden = !DEV || S.ended;

    $("preview-ending").textContent = previewEnding
        ? "그래프 닫기"
        : "현재 기록으로 그래프 보기";

    $("debug").hidden = !DEV;

    if (DEV) {
        const effects = S.queue.reduce((all, item) => {
            const selected = S.selections[item.id];

            return selected
                ? add(
                    all,
                    effectsFor(
                        eventById(item.id),
                        selected.action,
                        selected.pack
                    )
                )
                : all;
        }, {});

        $("debug").textContent = JSON.stringify({
            month: S.month,
            stats: S.stats,
            market: S.market,
            budget: account,
            effects,
            weights: sourceWeights(),
            history: S.history,
            selections: S.selections
        }, null, 2);
    }

    if (focusData) {
        const button = [
            ...$("events").querySelectorAll("button")
        ].find(item =>
            Object.entries(focusData).every(
                ([key, value]) =>
                    item.dataset[key] === value
            )
        );

        if (button && !button.disabled) {
            button.focus({
                preventScroll: true
            });
        }
    }
}


/* =========================================================
   로딩과 입력
========================================================= */

async function boot() {
    try {
        [C, EVENTS, TEXT] = await Promise.all(
            ["config", "events", "briefings"].map(
                async name => {
                    const response = await fetch(
                        `./data/${name}.json`,
                        { cache: "no-store" }
                    );

                    if (!response.ok) {
                        throw new Error(
                            `${name}.json: HTTP ${response.status}`
                        );
                    }

                    try {
                        return await response.json();
                    } catch (_) {
                        throw new Error(
                            `${name}.json의 쉼표·따옴표·괄호를 확인하세요.`
                        );
                    }
                }
            )
        );

        validateData();

        for (const id of [
            "ending-chart",
            "ending-t-start",
            "ending-t-end",
            "ending-h-start",
            "ending-h-end"
        ]) {
            if (!$(id)) {
                throw new Error(
                    `index.html에 ${id} 영역이 필요합니다.`
                );
            }
        }

        // 개발 모드 그래프 미리보기 버튼
        const controls = document.createElement("div");

        controls.id = "dev-controls";
        controls.className = "dev-preview-controls";
        controls.hidden = true;

        controls.innerHTML = `
            <p>
                개발 모드 · 확정된 기록으로 그래프를 확인합니다.
            </p>
            <button id="preview-ending" type="button">
                현재 기록으로 그래프 보기
            </button>
        `;

        $("debug").before(controls);

        $("preview-ending").addEventListener(
            "click",
            () => {
                if (!DEV || !S || S.ended) return;

                previewEnding = !previewEnding;
                render();

                if (previewEnding) {
                    $("ending").scrollIntoView({
                        block: "start"
                    });
                }
            }
        );

        window.addEventListener("resize", () => {
            if (
                S
                && (
                    S.ended
                    || (DEV && previewEnding)
                )
            ) {
                renderChart();
            }
        });

        try {
            const probe = `${SAVE_KEY}-test`;

            localStorage.setItem(probe, "1");
            localStorage.removeItem(probe);

        } catch (_) {
            storageAvailable = false;
        }

        S = loadSaved();

        if (S && budget().remaining < 0) {
            S = null;
        }

        $("start").disabled = false;

        $("start").textContent = S
            ? (
                S.ended
                    ? "저장된 결산 보기"
                    : "저장된 업무 이어가기"
            )
            : "업무 시작";

        $("load-note").textContent = storageAvailable
            ? "선택은 월말 확정 전까지 수정할 수 있습니다. "
            + "진행은 이 브라우저에 자동 저장됩니다."
            : "이 환경에서는 자동 저장을 사용할 수 없습니다. "
            + "새로고침하면 진행이 사라집니다.";

        $("start").addEventListener("click", () => {
            if (S) {
                render();
            } else {
                newGame();
            }
        });

        $("restart").addEventListener("click", () => {
            if (
                confirm("현재 진행을 지우고 1월부터 시작할까요?")
            ) {
                newGame();
            }
        });

        $("next-month").addEventListener(
            "click",
            finishMonth
        );

        document.addEventListener("click", event => {
            const button = event.target.closest("button");

            if (!button || button.disabled) return;

            if (button.dataset.help) {
                const help = C.help[button.dataset.help];

                $("help-title").textContent = help.title;
                $("help-copy").textContent = help.text;
                $("help-dialog").showModal();

                return;
            }

            if (
                !S
                || S.ended
                || !button.dataset.event
            ) {
                return;
            }

            const id = button.dataset.event;

            if (
                button.dataset.clear
                && canClear(id)
            ) {
                delete S.selections[id];

                persist();
                render();

            } else if (button.dataset.action) {
                const action = button.dataset.action;

                if (
                    S.selections[id]?.action === action
                    || !canChoose(id, action)
                ) {
                    return;
                }

                S.selections[id] = {
                    action,
                    pack: null
                };

                persist();
                render();

            } else if (button.dataset.pack) {
                const pack = button.dataset.pack;
                const selected = S.selections[id];

                if (
                    !selected
                    || selected.action === "defer"
                    || !canChoose(
                        id,
                        selected.action,
                        pack
                    )
                ) {
                    return;
                }

                S.selections[id] = {
                    action: selected.action,
                    pack
                };

                persist();
                render();
            }
        });

    } catch (error) {
        $("start").disabled = true;

        $("load-note").textContent =
            `불러오기 실패: ${error.message} `
            + "Live Server로 실행하고 JSON 파일을 확인하세요.";

        console.error(error);
    }
}

if (typeof document !== "undefined") {
    boot();
}