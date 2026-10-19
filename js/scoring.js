/**
 * Scoring Engine
 * Replays game_events to compute authoritative game state
 * Ported from Python scoring.py
 */

// Result codes catalogue
export const RESULTS = {
    '1B':  { label: 'Single',               cat: 'hit',  hit: true,  ab: true,  batted: true,  bases: 1 },
    '2B':  { label: 'Double',               cat: 'hit',  hit: true,  ab: true,  batted: true,  bases: 2 },
    '3B':  { label: 'Triple',               cat: 'hit',  hit: true,  ab: true,  batted: true,  bases: 3 },
    'HR':  { label: 'Home Run',             cat: 'hit',  hit: true,  ab: true,  batted: true,  bases: 4 },
    'BB':  { label: 'Walk',                 cat: 'bb',   hit: false, ab: false, batted: false, bases: 1 },
    'IBB': { label: 'Intentional Walk',     cat: 'bb',   hit: false, ab: false, batted: false, bases: 1 },
    'HBP': { label: 'Hit By Pitch',         cat: 'hbp',  hit: false, ab: false, batted: false, bases: 1 },
    'CI':  { label: 'Catcher Interference', cat: 'ci',   hit: false, ab: false, batted: false, bases: 1 },
    'ROE': { label: 'Reached On Error',     cat: 'roe',  hit: false, ab: true,  batted: true,  bases: 1 },
    'FC':  { label: 'Fielder\'s Choice',    cat: 'fc',   hit: false, ab: true,  batted: true,  bases: 1 },
    'D3K': { label: 'Dropped 3rd Strike',   cat: 'k',    hit: false, ab: true,  batted: false, bases: 1 },
    'GO':  { label: 'Groundout',            cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'FO':  { label: 'Flyout',               cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'LO':  { label: 'Lineout',              cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'POP': { label: 'Popout',               cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'FOUL':{ label: 'Foul Out',             cat: 'out',  hit: false, ab: true,  batted: false, bases: 0 },
    'DP':  { label: 'Double Play',          cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'TP':  { label: 'Triple Play',          cat: 'out',  hit: false, ab: true,  batted: true,  bases: 0 },
    'K':   { label: 'Strikeout (swinging)', cat: 'k',    hit: false, ab: true,  batted: false, bases: 0 },
    'KL':  { label: 'Strikeout (looking)',  cat: 'k',    hit: false, ab: true,  batted: false, bases: 0 },
    'SF':  { label: 'Sacrifice Fly',        cat: 'out',  hit: false, ab: false, batted: true,  bases: 0 },
    'SAC': { label: 'Sacrifice Bunt',       cat: 'out',  hit: false, ab: false, batted: true,  bases: 0 },
};

export const BR_RESULTS = {
    'SB':   { label: 'Stolen Base',          charge: null },
    'CS':   { label: 'Caught Stealing',      charge: 'catcher' },
    'PO':   { label: 'Pickoff',              charge: 'pitcher' },
    'POCS': { label: 'Pickoff-CS',           charge: 'catcher' },
    'WP':   { label: 'Wild Pitch',           charge: 'pitcher' },
    'PB':   { label: 'Passed Ball',          charge: 'catcher' },
    'BK':   { label: 'Balk',                 charge: 'pitcher' },
    'ADV':  { label: 'Advance',              charge: null },
    'OUT':  { label: 'Runner Out',           charge: null },
};

export const HIT_CODES = new Set(Object.entries(RESULTS).filter(([,v]) => v.hit).map(([k]) => k));
export const BB_CODES = new Set(['BB', 'IBB']);
export const K_CODES = new Set(['K', 'KL']);
export const TB_MAP = { '1B': 1, '2B': 2, '3B': 3, 'HR': 4 };

export const INHERENT_OUTS = {
    'K': 1, 'KL': 1, 'GO': 1, 'FO': 1, 'LO': 1, 'POP': 1, 'FOUL': 1,
    'SF': 1, 'SAC': 1, 'DP': 1, 'TP': 1,
};

export const POS_NUM = { 1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF' };
export const POS_TO_NUM = { 'P': 1, 'C': 2, '1B': 3, '2B': 4, '3B': 5, 'SS': 6, 'LF': 7, 'CF': 8, 'RF': 9 };

/**
 * Replay game events and return authoritative game state
 * @param {Array} events - Array of game_events ordered by seq
 * @param {Object} game - Game object with innings, status
 * @returns {Object} Game state
 */
export function computeState(events, game) {
    const regulation = game.innings || 9;
    let inning = 1, half = 'top', outs = 0;
    const bases = { '1': null, '2': null, '3': null };
    const score = { away: 0, home: 0 };
    const hits = { away: 0, home: 0 };
    const errors = { away: 0, home: 0 };
    const line = {};
    const played = {};

    const battingSide = (h) => h === 'top' ? 'away' : 'home';
    const fieldingSide = (h) => h === 'top' ? 'home' : 'away';

    for (const e of events) {
        inning = e.inning;
        half = e.half;
        const bside = battingSide(half);
        const fside = fieldingSide(half);

        line[inning] = line[inning] || { top: 0, bottom: 0 };
        played[inning] = played[inning] || { top: false, bottom: false };

        if (e.kind === 'PA' || e.kind === 'BR') {
            played[inning][half] = true;
        }

        if (e.runs_scored) {
            score[bside] += e.runs_scored;
            line[inning][half] += e.runs_scored;
        }

        if (e.kind === 'PA' && HIT_CODES.has(e.result)) {
            hits[bside] += 1;
        }

        if (e.is_error) {
            let nErr = 1;
            if (e.errors_json) {
                try {
                    const lst = JSON.parse(e.errors_json);
                    if (Array.isArray(lst) && lst.length) nErr = lst.length;
                } catch { nErr = 1; }
            }
            errors[fside] += nErr;
        }

        outs += e.outs_recorded || 0;

        if (e.advances) {
            try {
                const snap = JSON.parse(e.advances);
                bases['1'] = snap['1'] ?? null;
                bases['2'] = snap['2'] ?? null;
                bases['3'] = snap['3'] ?? null;
            } catch {}
        }

        if (outs >= 3) {
            outs = 0;
            bases['1'] = bases['2'] = bases['3'] = null;
            if (half === 'top') half = 'bottom';
            else { half = 'top'; inning += 1; }
        }
    }

    return {
        inning, half, outs,
        bases,
        score,
        hits,
        errors,
        line,
        played,
        regulation_innings: regulation,
        status: game.status,
        event_count: events.length
    };
}

/**
 * Generator that replays events and yields scoring attribution
 * @yields {Object} { event, scorers: Array<playerId>, batterScored: boolean }
 */
export function* replay(events) {
    const bases = { '1': null, '2': null, '3': null };
    for (const e of events) {
        let adv = null;
        if (e.advances) {
            try { adv = JSON.parse(e.advances); } catch {}
        }
        const before = { ...bases };
        const after = adv ? { '1': adv['1'] ?? null, '2': adv['2'] ?? null, '3': adv['3'] ?? null } : { ...bases };
        const runs = e.runs_scored || 0;
        const scorers = [];
        let batterScored = false;

        if (runs) {
            let remaining = runs;
            if (e.kind === 'PA' && e.result === 'HR') {
                batterScored = true;
                remaining -= 1;
            }
            const afterIds = new Set(Object.values(after).filter(v => v));
            for (const b of ['3', '2', '1']) {
                if (remaining <= 0) break;
                const pid = before[b];
                if (pid && !afterIds.has(pid)) {
                    scorers.push(pid);
                    remaining -= 1;
                }
            }
        }
        bases['1'] = after['1'];
        bases['2'] = after['2'];
        bases['3'] = after['3'];
        yield { event: e, scorers, batterScored };
    }
}

/**
 * Extract fielder numbers from detail notation (e.g., '6-4-3' -> [6,4,3])
 */
export function fielderNums(detail) {
    if (!detail) return [];
    return [...detail.matchAll(/\d/g)].map(m => parseInt(m[0])).filter(n => n !== 0);
}

/**
 * Get first fielder number from detail
 */
export function firstFielder(detail) {
    if (!detail) return null;
    const m = detail.match(/\d/);
    return m ? parseInt(m[0]) : null;
}

/**
 * Build fielding position map from active lineups
 * Returns { away: { posNum: playerId }, home: { posNum: playerId } }
 */
export function fieldingPosMap(lineups) {
    const out = { away: {}, home: {} };
    for (const l of lineups) {
        if (!l.active) continue;
        const num = POS_TO_NUM[(l.position || '').toUpperCase()];
        if (num) out[l.side][num] = l.player_id;
    }
    return out;
}

/**
 * Get result catalogue for UI
 */
export function resultCatalogue() {
    return {
        batting: RESULTS,
        baserunning: BR_RESULTS,
        pitchTypes: PITCH_TYPES,
        pitchResults: PITCH_RESULTS
    };
}

// Pitch types
export const PITCH_TYPES = {
    'FF': { label: 'Four-Seam Fastball', short: 'FF' },
    'SI': { label: 'Sinker / Two-Seam',  short: 'SI' },
    'FC': { label: 'Cutter',             short: 'FC' },
    'SL': { label: 'Slider',             short: 'SL' },
    'CB': { label: 'Curveball',          short: 'CB' },
    'CH': { label: 'Changeup',           short: 'CH' },
    'SP': { label: 'Splitter',           short: 'SP' },
    'KN': { label: 'Knuckleball',        short: 'KN' },
};

export const PITCH_RESULTS = {
    'B':   { label: 'Ball',            isStrike: false, isSwing: false },
    'CS':  { label: 'Called Strike',   isStrike: true,  isSwing: false },
    'SS':  { label: 'Swinging Strike', isStrike: true,  isSwing: true },
    'F':   { label: 'Foul',            isStrike: true,  isSwing: true },
    'IP':  { label: 'In Play',         isStrike: false, isSwing: true },
    'HBP': { label: 'Hit By Pitch',    isStrike: false, isSwing: false },
};

export const IN_ZONE = new Set([1,2,3,4,5,6,7,8,9]);
export const OUT_ZONE = new Set([11,12,13,14]);

export const ALL_ZONES = [1,2,3,4,5,6,7,8,9,11,12,13,14];

export { computeState as computeStateFromEvents };