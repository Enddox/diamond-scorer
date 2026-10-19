/**
 * Statistics Engine
 * Aggregates batting, pitching, fielding, and standings from game events
 * Ported from Python stats.py
 */

import { RESULTS, HIT_CODES, BB_CODES, K_CODES, TB_MAP, INHERENT_OUTS, fielderNums, firstFielder, fieldingPosMap, replay } from './scoring.js';

// Blank stat templates
function blankBat() {
    return { G: 0, PA: 0, AB: 0, R: 0, H: 0, '1B': 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, IBB: 0, SO: 0, HBP: 0, SF: 0, SAC: 0, SB: 0, CS: 0, TB: 0 };
}
function blankPit() {
    return { G: 0, BF: 0, Outs: 0, H: 0, R: 0, ER: 0, HR: 0, BB: 0, IBB: 0, SO: 0, HBP: 0, W: 0, L: 0, SV: 0, Pit: 0, Str: 0, Sw: 0, Whiff: 0 };
}
function blankFld() {
    return { G: 0, E: 0, PO: 0, A: 0, DP: 0, cCS: 0, cSB: 0, cPB: 0, cPO: 0, pWP: 0, pPO: 0 };
}

/**
 * Select games based on scope filters
 */
export async function selectGames(api, options = {}) {
    let query = api.supabase.from('games').select(`
        *,
        tourneys(category_id),
        away_team:teams!away_team_id(name, abbrev),
        home_team:teams!home_team_id(name, abbrev)
    `).neq('status', 'scheduled');

    if (options.gameId) query = query.eq('id', options.gameId);
    if (options.categoryId) query = query.eq('tourneys.category_id', options.categoryId);
    if (options.tourneyId) query = query.eq('tourney_id', options.tourneyId);
    if (options.teamId) query = query.or(`away_team_id.eq.${options.teamId},home_team_id.eq.${options.teamId}`);

    query = query.order('game_date', { ascending: true, nullsLast: true }).order('id');
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/**
 * Map players to their team for a specific game via lineups
 */
async function playerTeamMap(api, gameId) {
    const { data, error } = await api.supabase
        .from('game_lineups')
        .select('player_id, side')
        .eq('game_id', gameId)
        .eq('active', true);
    if (error) throw error;
    const map = {};
    for (const r of data) {
        map[r.player_id] = r.side === 'away' ? 'away' : 'home';
    }
    return map;
}

/**
 * Core accumulation across games
 */
async function accumulate(api, games) {
    const bat = new Map();
    const pit = new Map();
    const fld = new Map();
    const playerTeam = {};
    const seenBat = new Map();
    const seenPit = new Map();
    const seenFld = new Map();

    const B = pid => { if (!bat.has(pid)) bat.set(pid, blankBat()); return bat.get(pid); };
    const P = pid => { if (!pit.has(pid)) pit.set(pid, blankPit()); return pit.get(pid); };
    const F = pid => { if (!fld.has(pid)) fld.set(pid, blankFld()); return fld.get(pid); };
    const mark = (seen, pid, gid) => { if (!seen.has(pid)) seen.set(pid, new Set()); if (!seen.get(pid).has(gid)) { seen.get(pid).add(gid); return true; } return false; };

    for (const g of games) {
        const gid = g.id;
        const tm = await playerTeamMap(api, gid);
        Object.assign(playerTeam, Object.fromEntries(Object.entries(tm).map(([k,v]) => [k, v === 'away' ? g.away_team_id : g.home_team_id])));
        const lineups = await api.getLineups(gid);
        const posmap = fieldingPosMap(lineups);
        const events = await api.getEvents(gid);

        // Win/Loss/Save
        for (const [role, key] of [['win_pitcher_id', 'W'], ['loss_pitcher_id', 'L'], ['save_pitcher_id', 'SV']]) {
            const pid = g[role];
            if (pid) {
                const p = P(pid);
                p[key] += 1;
                if (mark(seenPit, pid, gid)) p.G += 1;
            }
        }

        for (const { event: e, scorers, batterScored } of replay(events)) {
            const res = e.result;
            const info = RESULTS[res] || {};
            const batter = e.batter_id;
            const pitcher = e.pitcher_id;
            const catcher = e.catcher_id;

            // Batting
            if (e.kind === 'PA' && batter) {
                const b = B(batter);
                if (mark(seenBat, batter, gid)) b.G += 1;
                b.PA += 1;
                if (info.ab) b.AB += 1;
                if (HIT_CODES.has(res)) { b.H += 1; b[res] += 1; b.TB += TB_MAP[res] || 0; }
                if (BB_CODES.has(res)) { b.BB += 1; if (res === 'IBB') b.IBB += 1; }
                if (res === 'HBP') b.HBP += 1;
                if (K_CODES.has(res)) b.SO += 1;
                if (res === 'SF') b.SF += 1;
                if (res === 'SAC') b.SAC += 1;
                b.RBI += e.rbi || 0;
                if (batterScored) b.R += 1;
            }

            // Baserunning
            if (e.kind === 'BR' && e.runner_id) {
                const rb = B(e.runner_id);
                if (res === 'SB') rb.SB += 1;
                else if (['CS', 'POCS'].includes(res)) rb.CS += 1;
            }

            // Runs scored by baserunners
            for (const pid of scorers) B(pid).R += 1;

            // Pitching
            if (pitcher) {
                const p = P(pitcher);
                if (mark(seenPit, pitcher, gid)) p.G += 1;
                if (e.kind === 'PA') {
                    p.BF += 1;
                    if (HIT_CODES.has(res)) p.H += 1;
                    if (res === 'HR') p.HR += 1;
                    if (BB_CODES.has(res)) { p.BB += 1; if (res === 'IBB') p.IBB += 1; }
                    if (res === 'HBP') p.HBP += 1;
                    if (K_CODES.has(res)) p.SO += 1;
                }
                p.Outs += e.outs_recorded || 0;
                const runs = e.runs_scored || 0;
                p.R += runs;
                if (!e.is_error) p.ER += runs;
            }

            // Fielding / Catcher / Battery
            if (e.is_error) {
                let errIds = [];
                if (e.errors_json) {
                    try { errIds = JSON.parse(e.errors_json); } catch {}
                }
                if (!errIds.length && e.error_on) errIds = [e.error_on];
                for (const eid of errIds) { F(eid).E += 1; mark(seenFld, eid, gid); }
            }

            // Putouts/Assists from fielder notation
            if (e.kind === 'PA' && info.cat === 'out' && info.batted) {
                const fldSide = e.half === 'top' ? 'home' : 'away';
                const nums = fielderNums(e.detail);
                const pm = posmap[fldSide] || {};
                if (nums.length) {
                    const outsOnPlay = e.outs_recorded || 1;
                    const poCount = Math.min(Math.max(1, outsOnPlay), nums.length);
                    for (const n of nums.slice(0, -1)) {
                        const pid = pm[n]; if (pid) { F(pid).A += 1; mark(seenFld, pid, gid); }
                    }
                    for (const n of nums.slice(-poCount)) {
                        const pid = pm[n]; if (pid) { F(pid).PO += 1; mark(seenFld, pid, gid); }
                    }
                    if (['DP', 'TP'].includes(res)) {
                        for (const n of new Set(nums)) { const pid = pm[n]; if (pid) F(pid).DP += 1; }
                    }
                }
            }

            if (e.kind === 'BR') {
                if (['CS', 'POCS', 'PO'].includes(res) && !e.is_error) {
                    const fldSide = e.half === 'top' ? 'home' : 'away';
                    const pm = posmap[fldSide] || {};
                    const nums = fielderNums(e.detail);
                    if (nums.length) {
                        for (const n of nums.slice(0, -1)) { const pid = pm[n]; if (pid) { F(pid).A += 1; mark(seenFld, pid, gid); } }
                        const last = pm[nums[nums.length - 1]]; if (last) { F(last).PO += 1; mark(seenFld, last, gid); }
                    }
                }
                if (['CS', 'POCS'].includes(res) && catcher) F(catcher).cCS += 1;
                else if (res === 'SB' && catcher) F(catcher).cSB += 1;
                else if (res === 'PB' && catcher) F(catcher).cPB += 1;
                else if (res === 'PO') {
                    if (e.credited_to === 'pitcher' && pitcher) F(pitcher).pPO += 1;
                    else if (catcher) F(catcher).cPO += 1;
                } else if (res === 'WP' && pitcher) F(pitcher).pWP += 1;
            }
        }

        // Pitch-level detail
        const pitches = await api.getPitches(gid);
        for (const pr of pitches) {
            if (!pr.pitcher_id) continue;
            const p = P(pr.pitcher_id);
            p.Pit += 1;
            p.Str += pr.is_strike || 0;
            p.Sw += pr.is_swing || 0;
            if (pr.result === 'SS') p.Whiff += 1;
        }
    }

    return { bat, pit, fld, playerTeam };
}

function rate(num, den, nd = 3) { return den ? Math.round(num / den * 10**nd) / 10**nd : 0; }

async function getNames(api, pids) {
    const ids = [...new Set(pids.filter(Boolean))];
    if (!ids.length) return {};
    const { data, error } = await api.supabase.from('players').select('id, first_name, middle_name, last_name, second_last_name').in('id', ids);
    if (error) throw error;
    const map = {};
    for (const r of data) {
        const parts = [r.first_name, r.middle_name, r.last_name, r.second_last_name].filter(Boolean);
        map[r.id] = parts.join(' ');
    }
    return map;
}

async function getTeamNames(api, tids) {
    const ids = [...new Set(tids.filter(Boolean))];
    if (!ids.length) return {};
    const { data, error } = await api.supabase.from('teams').select('id, name, abbrev, place').in('id', ids);
    if (error) throw error;
    return Object.fromEntries(data.map(r => [r.id, r]));
}

function finishBatting(pid, s, names, teams, playerTeam) {
    const ab = s.AB, h = s.H, bb = s.BB, hbp = s.HBP, sf = s.SF;
    const avg = rate(h, ab);
    const obp = rate(h + bb + hbp, ab + bb + hbp + sf);
    const slg = rate(s.TB, ab);
    const babipDen = ab - s.SO - s.HR + sf;
    const teamId = playerTeam[pid];
    const team = teamId ? teams[teamId] : null;
    return {
        player_id: pid, name: names[pid] || `#${pid}`,
        team: team ? (team.abbrev || team.name) : '',
        ...s,
        AVG: avg, OBP: obp, SLG: slg, OPS: Math.round((obp + slg) * 1000) / 1000,
        ISO: Math.round((slg - avg) * 1000) / 1000,
        BABIP: rate(h - s.HR, babipDen),
        'BB%': rate(bb, s.PA), 'K%': rate(s.SO, s.PA),
        'SB%': rate(s.SB, s.SB + s.CS)
    };
}

function finishPitching(pid, s, names, teams, playerTeam) {
    const ip3 = s.Outs;
    const ip = ip3 / 3;
    const ipDisp = `${Math.floor(ip)}.${ip3 % 3}`;
    const teamId = playerTeam[pid];
    const team = teamId ? teams[teamId] : null;
    return {
        player_id: pid, name: names[pid] || `#${pid}`,
        team: team ? (team.abbrev || team.name) : '',
        ...s,
        IP: ipDisp,
        ERA: ip ? Math.round(9 * s.ER / ip * 100) / 100 : 0,
        RA9: ip ? Math.round(9 * s.R / ip * 100) / 100 : 0,
        WHIP: ip ? Math.round((s.H + s.BB) / ip * 100) / 100 : 0,
        K9: ip ? Math.round(9 * s.SO / ip * 100) / 100 : 0,
        BB9: ip ? Math.round(9 * s.BB / ip * 100) / 100 : 0,
        KBB: s.BB ? Math.round(s.SO / s.BB * 100) / 100 : s.SO,
        'Str%': rate(s.Str, s.Pit), 'Sw%': rate(s.Sw, s.Pit), 'Whiff%': rate(s.Whiff, s.Sw)
    };
}

function finishFielding(pid, s, names, teams, playerTeam) {
    const tc = s.PO + s.A + s.E;
    const teamId = playerTeam[pid];
    const team = teamId ? teams[teamId] : null;
    return {
        player_id: pid, name: names[pid] || `#${pid}`,
        team: team ? (team.abbrev || team.name) : '',
        ...s,
        TC: tc,
        FPCT: rate(s.PO + s.A, tc),
        'CS%': rate(s.cCS, s.cCS + s.cSB)
    };
}

/**
 * Compute standings (W-L) from completed games
 */
async function computeStandings(api, games) {
    const rec = new Map();
    for (const g of games) {
        if (!['finished', 'forfeited'].includes(g.status)) continue;
        const st = await computeState(api, g.id);
        const a = g.away_team_id, h = g.home_team_id;
        const ra = st.score.away, rh = st.score.home;
        for (const t of [a, h]) { if (!rec.has(t)) rec.set(t, { team_id: t, W: 0, L: 0, T: 0, RF: 0, RA: 0 }); }
        rec.get(a).RF += ra; rec.get(a).RA += rh;
        rec.get(h).RF += rh; rec.get(h).RA += ra;
        if (ra > rh) { rec.get(a).W += 1; rec.get(h).L += 1; }
        else if (rh > ra) { rec.get(h).W += 1; rec.get(a).L += 1; }
        else { rec.get(a).T += 1; rec.get(h).T += 1; }
    }
    const tids = [...rec.keys()];
    const teams = await getTeamNames(api, tids);
    const out = [];
    for (const [t, s] of rec) {
        const gp = s.W + s.L + s.T;
        const team = teams[t] || {};
        out.push({ team: team.name || `#${t}`, abbrev: team.abbrev || '', GP: gp,
            PCT: s.W + s.L ? rate(s.W, s.W + s.L) : 0,
            DIFF: s.RF - s.RA });
    }
    out.sort((a, b) => b.PCT - a.PCT || b.DIFF - a.DIFF || b.W - a.W);
    return out;
}

/**
 * Main stats function
 */
export async function stats(api, options = {}) {
    const games = await selectGames(api, options);
    const acc = await accumulate(api, games);
    const names = await getNames(api, [...acc.bat.keys(), ...acc.pit.keys(), ...acc.fld.keys()]);
    const teamIds = [...new Set(Object.values(acc.playerTeam))];
    const teams = await getTeamNames(api, teamIds);

    const keep = pid => !options.teamId || acc.playerTeam[pid] === options.teamId;

    const batting = Array.from(acc.bat.entries())
        .filter(([pid, s]) => keep(pid) && s.PA > 0)
        .map(([pid, s]) => finishBatting(pid, s, names, teams, acc.playerTeam))
        .sort((a, b) => b.OPS - a.OPS || b.H - a.H);

    const pitching = Array.from(acc.pit.entries())
        .filter(([pid, s]) => keep(pid) && (s.BF || s.Outs || s.G))
        .map(([pid, s]) => finishPitching(pid, s, names, teams, acc.playerTeam))
        .sort((a, b) => (a.Outs ? a.ERA : 999) - (b.Outs ? b.ERA : 999) || b.SO - a.SO);

    const fielding = Array.from(acc.fld.entries())
        .filter(([pid]) => keep(pid))
        .map(([pid, s]) => finishFielding(pid, s, names, teams, acc.playerTeam))
        .sort((a, b) => b.cCS - a.cCS || a.E - b.E);

    const standings = await computeStandings(api, games);

    return { batting, pitching, fielding, standings, game_count: games.length };
}

/**
 * Player gamelog
 */
export async function playerGamelog(api, playerId, options = {}) {
    const games = await selectGames(api, options);
    const log = [];
    for (const g of games) {
        const events = await api.getEvents(g.id);
        if (!events.some(e => e.batter_id === playerId || e.pitcher_id === playerId || e.runner_id === playerId)) continue;
        const acc = await accumulate(api, [g]);
        const b = acc.bat.get(playerId);
        const p = acc.pit.get(playerId);
        const teams = await getTeamNames(api, [g.away_team_id, g.home_team_id]);
        const oppId = acc.playerTeam[playerId] === 'away' ? g.home_team_id : g.away_team_id;
        const opp = teams[oppId] || {};
        const row = { game_id: g.id, date: g.game_date, opp: opp.abbrev || opp.name || '' };
        if (b) {
            const names = await getNames(api, [playerId]);
            row.batting = finishBatting(playerId, b, names, teams, acc.playerTeam);
        }
        if (p) {
            const names = await getNames(api, [playerId]);
            row.pitching = finishPitching(playerId, p, names, teams, acc.playerTeam);
        }
        log.push(row);
    }
    return log;
}

/**
 * Compute state for a single game (async version using API)
 */
export async function computeState(api, gameId) {
    const game = await api.getGame(gameId);
    const events = await api.getEvents(gameId);
    return computeStateFromEvents(events, game);
}

/**
 * Compute state from events (sync version)
 */
export function computeStateFromEvents(events, game) {
    const regulation = game.innings || 9;
    let inning = 1, half = 'top', outs = 0;
    const bases = { '1': null, '2': null, '3': null };
    const score = { away: 0, home: 0 };
    const hits = { away: 0, home: 0 };
    const errors = { away: 0, home: 0 };
    const line = {};
    const played = {};

    const battingSide = h => h === 'top' ? 'away' : 'home';
    const fieldingSide = h => h === 'top' ? 'home' : 'away';

    for (const e of events) {
        inning = e.inning; half = e.half;
        const bside = battingSide(half);
        const fside = fieldingSide(half);
        line[inning] = line[inning] || { top: 0, bottom: 0 };
        played[inning] = played[inning] || { top: false, bottom: false };
        if (e.kind === 'PA' || e.kind === 'BR') played[inning][half] = true;
        if (e.runs_scored) { score[bside] += e.runs_scored; line[inning][half] += e.runs_scored; }
        if (e.kind === 'PA' && HIT_CODES.has(e.result)) hits[bside] += 1;
        if (e.is_error) {
            let nErr = 1;
            if (e.errors_json) try { const lst = JSON.parse(e.errors_json); if (Array.isArray(lst) && lst.length) nErr = lst.length; } catch {}
            errors[fside] += nErr;
        }
        outs += e.outs_recorded || 0;
        if (e.advances) try { const snap = JSON.parse(e.advances); bases['1'] = snap['1'] ?? null; bases['2'] = snap['2'] ?? null; bases['3'] = snap['3'] ?? null; } catch {}
        if (outs >= 3) { outs = 0; bases['1'] = bases['2'] = bases['3'] = null; half = half === 'top' ? 'bottom' : 'top'; if (half === 'top') inning += 1; }
    }
    return { inning, half, outs, bases, score, hits, errors, line, played, regulation_innings: regulation, status: game.status, event_count: events.length };
}