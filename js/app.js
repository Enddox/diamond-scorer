/**
 * Diamond Scorer - Main Application
 * Handles routing, UI state, modals, and coordinates all modules
 */

import { api } from './api.js';
import { computeStateFromEvents, resultCatalogue, POS_NUM } from './scoring.js';
import { stats, playerGamelog } from './stats.js';
import { buildHeatmapSVG, buildSpraySVG, buildPitchZoneGrid, buildChaseZones } from './viz.js';
import { buildGameReportHTML, buildStatsHTML, generateGameReportPDF, generateStatsPDF } from './reports.js';
import { exportSession, exportSessionZIP, importSession, downloadTemplate } from './importexport.js';

// =========================================
// Global State
// =========================================
const state = {
    currentView: 'dashboard',
    supabaseConnected: false,
    currentGame: null,
    scorerUnsubs: [],
    filters: {
        tourneyCategory: '',
        teamCategory: '',
        playerTeam: '',
        gameTourney: '',
        gameStatus: '',
        statsCategory: '',
        statsTourney: '',
        statsTeam: '',
        statsTab: 'batting',
        statsLevel: 'basic'
    },
    cache: {
        categories: [],
        tourneys: [],
        teams: [],
        players: [],
        games: []
    }
};

// =========================================
// DOM Helpers
// =========================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function showView(view) {
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${view}`)?.classList.remove('hidden');
    $$('.nav-btn').forEach(btn => {
        btn.setAttribute('aria-current', btn.dataset.view === view ? 'page' : 'false');
    });
    state.currentView = view;
    loadViewData(view);
}

function toast(message, type = 'info', title = '') {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
        <div class="toast-icon">${type === 'error' ? '✕' : type === 'success' ? '✓' : 'ℹ'}</div>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            <div class="toast-message">${message}</div>
        </div>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
}

// =========================================
// Supabase Connection
// =========================================
async function initSupabase() {
    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');
    if (url && key) {
        try {
            api.init(url, key);
            const { data, error } = await api.supabase.from('categories').select('count').limit(1);
            if (!error) {
                state.supabaseConnected = true;
                updateConnectionStatus(true);
                toast('Conectado a Supabase', 'success');
                loadAllCache();
            } else throw error;
        } catch (err) {
            console.error('Supabase init error:', err);
            state.supabaseConnected = false;
            updateConnectionStatus(false);
        }
    }
}

function updateConnectionStatus(connected) {
    const el = $('#connection-status');
    if (connected) {
        el.classList.add('connected');
        el.title = 'Conectado a Supabase';
        $('#connection-status .status-dot')?.classList.add('connected');
    } else {
        el.classList.remove('connected');
        el.title = 'Desconectado';
        $('#connection-status .status-dot')?.classList.remove('connected');
    }
}

// =========================================
// Cache Loading
// =========================================
async function loadAllCache() {
    try {
        const [cats, tourneys, teams, players, games] = await Promise.all([
            api.getCategories(),
            api.getTourneys(),
            api.getTeams(),
            api.getPlayers(),
            api.getGames({ limit: 50 })
        ]);
        state.cache.categories = cats;
        state.cache.tourneys = tourneys;
        state.cache.teams = teams;
        state.cache.players = players;
        state.cache.games = games;
        populateFilters();
        renderDashboard();
    } catch (err) {
        console.error('Cache load error:', err);
        toast('Error cargando datos', 'error');
    }
}

function populateFilters() {
    // Categories for tourneys/teams filters
    const catOptions = state.cache.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    for (const id of ['filter-tourney-category', 'filter-team-category', 'stats-scope-category']) {
        const el = $(`#${id}`);
        if (el) el.innerHTML = `<option value="">Todas</option>` + catOptions;
    }
    // Teams for players/games filters
    const teamOptions = state.cache.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    for (const id of ['filter-player-team', 'filter-game-tourney', 'stats-scope-team']) {
        const el = $(`#${id}`);
        if (el) el.innerHTML = `<option value="">Todos</option>` + teamOptions;
    }
    // Tourneys for games/stats filters
    const tourneyOptions = state.cache.tourneys.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    for (const id of ['filter-game-tourney', 'stats-scope-tourney']) {
        const el = $(`#${id}`);
        if (el) el.innerHTML = `<option value="">Todos</option>` + tourneyOptions;
    }
}

// =========================================
// View Renderers
// =========================================
function renderDashboard() {
    $('#stat-tourneys').textContent = state.cache.tourneys.length;
    $('#stat-teams').textContent = state.cache.teams.length;
    $('#stat-players').textContent = state.cache.players.length;
    $('#stat-games').textContent = state.cache.games.length;

    const tbody = $('#recent-games-table tbody');
    tbody.innerHTML = state.cache.games.slice(0, 10).map(g => `
        <tr>
            <td>${g.game_date || '—'}</td>
            <td>${g.tourneys?.name || '—'}</td>
            <td>${g.away_team?.name || '—'}</td>
            <td>${g.home_team?.name || '—'}</td>
            <td>${g.away_score} - ${g.home_score}</td>
            <td><span class="badge badge-${g.status}">${g.status}</span></td>
            <td><button class="action-btn" data-action="open-scorer" data-game-id="${g.id}" title="Scorer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/><path d="M9 9v6h6"/></svg></button></td>
        </tr>
    `).join('');
}

async function loadViewData(view) {
    switch (view) {
        case 'categories': return renderCategories();
        case 'tourneys': return renderTourneys();
        case 'teams': return renderTeams();
        case 'players': return renderPlayers();
        case 'games': return renderGames();
        case 'stats': return renderStats();
    }
}

function catName(id) { return state.cache.categories.find(c => c.id === id)?.name || '—'; }
function teamName(id) { return state.cache.teams.find(t => t.id === id)?.name || '—'; }
function tourneyName(id) { return state.cache.tourneys.find(t => t.id === id)?.name || '—'; }

function renderCategories() {
    const tbody = $('#categories-table tbody');
    tbody.innerHTML = state.cache.categories.map(c => `
        <tr>
            <td>${c.name}</td>
            <td>${c.min_age}</td>
            <td>${c.max_age}</td>
            <td>
                <button class="action-btn" data-action="edit-category" data-id="${c.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="action-btn delete" data-action="delete-category" data-id="${c.id}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>
    `).join('');
}

async function renderTourneys() {
    const catId = state.filters.tourneyCategory || $('#filter-tourney-category')?.value;
    let tourneys = state.cache.tourneys;
    if (catId) tourneys = tourneys.filter(t => t.category_id == catId);

    const tbody = $('#tourneys-table tbody');
    tbody.innerHTML = tourneys.map(t => `
        <tr>
            <td>${t.name}</td>
            <td>${t.abbrev || '—'}</td>
            <td>${catName(t.category_id)}</td>
            <td>${t.year || '—'}</td>
            <td><span class="badge badge-${t.is_event ? 'in_progress' : 'scheduled'}">${t.is_event ? 'Evento' : 'Torneo'}</span></td>
            <td>${t._team_count || 0}</td>
            <td>
                <button class="action-btn" data-action="edit-tourney" data-id="${t.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="action-btn" data-action="manage-teams" data-id="${t.id}" title="Equipos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></button>
                <button class="action-btn delete" data-action="delete-tourney" data-id="${t.id}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>
    `).join('');
}

function renderTeams() {
    const catId = state.filters.teamCategory || $('#filter-team-category')?.value;
    let teams = state.cache.teams;
    if (catId) teams = teams.filter(t => t.category_id == catId);

    const tbody = $('#teams-table tbody');
    tbody.innerHTML = teams.map(t => `
        <tr>
            <td>${t.name}</td>
            <td>${t.abbrev || '—'}</td>
            <td>${t.place || '—'}</td>
            <td>${catName(t.category_id)}</td>
            <td>
                <button class="action-btn" data-action="edit-team" data-id="${t.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="action-btn delete" data-action="delete-team" data-id="${t.id}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>
    `).join('');
}

function renderPlayers() {
    const teamId = state.filters.playerTeam || $('#filter-player-team')?.value;
    let players = state.cache.players;
    if (teamId) players = players.filter(p => p.team_id == teamId);

    const tbody = $('#players-table tbody');
    tbody.innerHTML = players.map(p => `
        <tr>
            <td>${p.first_name} ${p.last_name}${p.second_last_name ? ' ' + p.second_last_name : ''}</td>
            <td>${p.position || '—'}</td>
            <td>${p.bats || '—'}/${p.throws || '—'}</td>
            <td>${teamName(p.team_id)}</td>
            <td>${p.jersey_number || '—'}</td>
            <td>${p.dob ? new Date(p.dob).toLocaleDateString('es-ES') : '—'}</td>
            <td>
                <button class="action-btn" data-action="edit-player" data-id="${p.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="action-btn delete" data-action="delete-player" data-id="${p.id}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>
    `).join('');
}

async function renderGames() {
    const tourneyId = $('#filter-game-tourney')?.value;
    const status = $('#filter-game-status')?.value;
    let games = state.cache.games;
    if (tourneyId) games = games.filter(g => g.tourney_id == tourneyId);
    if (status) games = games.filter(g => g.status === status);

    const tbody = $('#games-table tbody');
    tbody.innerHTML = games.map(g => `
        <tr>
            <td>${g.game_date || '—'}</td>
            <td>${tourneyName(g.tourney_id)}</td>
            <td>${teamName(g.away_team_id)}</td>
            <td>${teamName(g.home_team_id)}</td>
            <td><strong>${g.away_score} - ${g.home_score}</strong></td>
            <td>${g.innings}</td>
            <td><span class="badge badge-${g.status}">${g.status}</span></td>
            <td>
                <button class="action-btn" data-action="open-scorer" data-game-id="${g.id}" title="Scorer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/><path d="M9 9v6h6"/></svg></button>
                <button class="action-btn" data-action="view-report" data-game-id="${g.id}" title="Reporte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
                <button class="action-btn" data-action="edit-game" data-id="${g.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="action-btn delete" data-action="delete-game" data-id="${g.id}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>
    `).join('');
}

async function renderStats() {
    const container = $('#stats-container');
    container.innerHTML = '<div class="empty-state"><p>Cargando estadísticas...</p></div>';

    try {
        const data = await stats(api, {
            categoryId: state.filters.statsCategory || null,
            tourneyId: state.filters.statsTourney || null,
            teamId: state.filters.statsTeam || null
        });

        const players = data[state.filters.statsTab] || [];
        const cols = { batting: BAT_COLS, pitching: PIT_COLS, fielding: FLD_COLS }[state.filters.statsTab] || BAT_COLS;
        let colDefs = [...cols.basic];
        if (state.filters.statsLevel !== 'basic') colDefs.push(...cols.advanced);
        if (state.filters.statsLevel === 'detailed') colDefs.push(...cols.detailed);

        const head = '<th class="l">Player</th><th class="l">Tm</th>' + colDefs.map(([,l]) => `<th>${l}</th>`).join('');
        const body = players.map(r => `<tr><td class="l">${r.name}</td><td class="l">${r.team || ''}</td>` + colDefs.map(([k, , rt]) => `<td>${fmt(r[k], rt)}</td>`).join('') + '</tr>').join('');

        if (state.filters.statsTab === 'standings') {
            const standHead = '<th class="l">#</th><th class="l">Team</th>' + STAND_COLS.map(([,l]) => `<th>${l}</th>`).join('');
            const standBody = data.standings.map((r, i) => `<tr><td class="l">${i+1}</td><td class="l">${r.team}</td>` + STAND_COLS.map(([k, , rt]) => `<td>${fmt(r[k], rt)}</td>`).join('') + '</tr>').join('');
            container.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr>${standHead}</tr></thead><tbody>${standBody}</tbody></table></div>`;
        } else {
            container.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
        }
    } catch (err) {
        console.error('Stats error:', err);
        container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
}

// Column definitions for stats tables
const BAT_COLS = { basic: [['G','G'],['PA','PA'],['AB','AB'],['R','R'],['H','H'],['HR','HR'],['RBI','RBI'],['BB','BB'],['SO','SO'],['AVG','AVG',1],['OBP','OBP',1],['SLG','SLG',1],['OPS','OPS',1]], advanced: [['2B','2B'],['3B','3B'],['SB','SB'],['CS','CS'],['TB','TB'],['ISO','ISO',1],['BB%','BB%',1],['K%','K%',1]], detailed: [['IBB','IBB'],['HBP','HBP'],['SF','SF'],['SAC','SAC'],['BABIP','BABIP',1],['SB%','SB%',1]] };
const PIT_COLS = { basic: [['G','G'],['W','W'],['L','L'],['SV','SV'],['IP','IP'],['H','H'],['R','R'],['ER','ER'],['BB','BB'],['SO','SO'],['ERA','ERA',2],['WHIP','WHIP',2]], advanced: [['HR','HR'],['HBP','HBP'],['K9','K/9',2],['BB9','BB/9',2],['KBB','K/BB',2],['RA9','RA/9',2]], detailed: [['BF','BF'],['Pit','Pit'],['Str%','Str%',1],['Sw%','Sw%',1],['Whiff%','Whiff%',1],['IBB','IBB']] };
const FLD_COLS = { basic: [['G','G'],['PO','PO'],['A','A'],['E','E'],['DP','DP'],['FPCT','FPCT',1]], advanced: [['TC','TC'],['cCS','CS'],['cSB','SB'],['CS%','CS%',1],['cPB','PB']], detailed: [['cPO','PO(C)'],['pWP','WP'],['pPO','PO(P)']] };
const STAND_COLS = [['GP','GP'],['W','W'],['L','L'],['T','T'],['PCT','PCT',1],['RF','RF'],['RA','RA'],['DIFF','DIFF']];

function fmt(v, rate) {
    if (v == null || v === '') return '';
    if (rate === 1) { const f = parseFloat(v); if (isNaN(f)) return v; const s = f.toFixed(3); return f < 1 && f >= 0 ? s.slice(1) : s; }
    if (rate === 2) { const f = parseFloat(v); if (isNaN(f)) return v; return f.toFixed(2); }
    return String(v);
}

// =========================================
// Modal Management
// =========================================
const modalOverlay = $('#modal-overlay');
const modal = $('#modal');
const modalTitle = $('#modal-title');
const modalForm = $('#modal-form');

function openModal(title, html, onSubmit) {
    modalTitle.textContent = title;
    modalForm.innerHTML = html;
    modalForm.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(modalForm);
        const data = Object.fromEntries(formData);
        try {
            await onSubmit(data);
            closeModal();
            toast('Guardado correctamente', 'success');
            loadViewData(state.currentView);
        } catch (err) {
            toast(err.message, 'error', 'Error');
        }
    };
    modalOverlay.classList.remove('hidden');
    modalForm.querySelector('input, select')?.focus();
}

function closeModal() {
    modalOverlay.classList.add('hidden');
    modalForm.innerHTML = '';
}

// =========================================
// CRUD Form Handlers
// =========================================
function setupModals() {
    // Category
    $('#view-categories').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-category') {
            openModal('Nueva Categoría', categoryFormHTML(), async d => { await api.createCategory(d); await loadAllCache(); });
        } else if (btn.dataset.action === 'edit-category') {
            const cat = state.cache.categories.find(c => c.id == btn.dataset.id);
            openModal('Editar Categoría', categoryFormHTML(cat), async d => { await api.updateCategory(cat.id, d); await loadAllCache(); });
        } else if (btn.dataset.action === 'delete-category') {
            if (confirm('¿Eliminar esta categoría?')) { await api.deleteCategory(btn.dataset.id); await loadAllCache(); }
        }
    });

    // Tourneys
    $('#view-tourneys').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-tourney') {
            openModal('Nuevo Torneo', tourneyFormHTML(), async d => { d.category_id = parseInt(d.category_id); d.is_event = d.is_event === 'on'; d.year = d.year ? parseInt(d.year) : null; await api.createTourney(d); await loadAllCache(); });
        } else if (btn.dataset.action === 'edit-tourney') {
            const t = state.cache.tourneys.find(x => x.id == btn.dataset.id);
            openModal('Editar Torneo', tourneyFormHTML(t), async d => { d.category_id = parseInt(d.category_id); d.is_event = d.is_event === 'on'; d.year = d.year ? parseInt(d.year) : null; await api.updateTourney(t.id, d); await loadAllCache(); });
        } else if (btn.dataset.action === 'manage-teams') {
            openTourneyTeamsModal(btn.dataset.id);
        } else if (btn.dataset.action === 'delete-tourney') {
            if (confirm('¿Eliminar este torneo?')) { await api.deleteTourney(btn.dataset.id); await loadAllCache(); }
        }
    });

    // Teams
    $('#view-teams').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-team') {
            openModal('Nuevo Equipo', teamFormHTML(), async d => { d.category_id = parseInt(d.category_id); await api.createTeam(d); await loadAllCache(); });
        } else if (btn.dataset.action === 'edit-team') {
            const t = state.cache.teams.find(x => x.id == btn.dataset.id);
            openModal('Editar Equipo', teamFormHTML(t), async d => { d.category_id = parseInt(d.category_id); await api.updateTeam(t.id, d); await loadAllCache(); });
        } else if (btn.dataset.action === 'delete-team') {
            if (confirm('¿Eliminar este equipo?')) { await api.deleteTeam(btn.dataset.id); await loadAllCache(); }
        }
    });

    // Players
    $('#view-players').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-player') {
            openModal('Nuevo Jugador', playerFormHTML(), async d => { d.team_id = d.team_id ? parseInt(d.team_id) : null; d.jersey_number = d.jersey_number ? parseInt(d.jersey_number) : null; d.weight_kg = d.weight_kg ? parseFloat(d.weight_kg) : null; d.height_cm = d.height_cm ? parseInt(d.height_cm) : null; await api.createPlayer(d); await loadAllCache(); });
        } else if (btn.dataset.action === 'edit-player') {
            const p = state.cache.players.find(x => x.id == btn.dataset.id);
            openModal('Editar Jugador', playerFormHTML(p), async d => { d.team_id = d.team_id ? parseInt(d.team_id) : null; d.jersey_number = d.jersey_number ? parseInt(d.jersey_number) : null; d.weight_kg = d.weight_kg ? parseFloat(d.weight_kg) : null; d.height_cm = d.height_cm ? parseInt(d.height_cm) : null; await api.updatePlayer(p.id, d); await loadAllCache(); });
        } else if (btn.dataset.action === 'delete-player') {
            if (confirm('¿Eliminar este jugador?')) { await api.deletePlayer(btn.dataset.id); await loadAllCache(); }
        }
    });

    // Games
    $('#view-games').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-game') {
            openModal('Nuevo Juego', gameFormHTML(), async d => { d.tourney_id = parseInt(d.tourney_id); d.away_team_id = parseInt(d.away_team_id); d.home_team_id = parseInt(d.home_team_id); d.innings = parseInt(d.innings) || 9; d.away_score = 0; d.home_score = 0; d.status = 'scheduled'; await api.createGame(d); await loadAllCache(); });
        } else if (btn.dataset.action === 'open-scorer') {
            openScorer(btn.dataset.gameId);
        } else if (btn.dataset.action === 'view-report') {
            viewGameReport(btn.dataset.gameId);
        } else if (btn.dataset.action === 'edit-game') {
            const g = state.cache.games.find(x => x.id == btn.dataset.id);
            openModal('Editar Juego', gameFormHTML(g), async d => { d.tourney_id = parseInt(d.tourney_id); d.away_team_id = parseInt(d.away_team_id); d.home_team_id = parseInt(d.home_team_id); d.innings = parseInt(d.innings) || 9; await api.updateGame(g.id, d); await loadAllCache(); });
        } else if (btn.dataset.action === 'delete-game') {
            if (confirm('¿Eliminar este juego?')) { await api.deleteGame(btn.dataset.id); await loadAllCache(); }
        }
    });

    // Dashboard quick actions
    $('#view-dashboard').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'new-tourney') { openModal('Nuevo Torneo', tourneyFormHTML(), async d => { d.category_id = parseInt(d.category_id); d.is_event = d.is_event === 'on'; d.year = d.year ? parseInt(d.year) : null; await api.createTourney(d); await loadAllCache(); }); }
        if (btn.dataset.action === 'new-game') { openModal('Nuevo Juego', gameFormHTML(), async d => { d.tourney_id = parseInt(d.tourney_id); d.away_team_id = parseInt(d.away_team_id); d.home_team_id = parseInt(d.home_team_id); d.innings = parseInt(d.innings) || 9; d.away_score = 0; d.home_score = 0; d.status = 'scheduled'; await api.createGame(d); await loadAllCache(); }); }
    });
}

// Form HTML templates
function categoryFormHTML(cat = {}) {
    return `<div class="form-group"><label>Nombre</label><input name="name" class="form-input" value="${cat.name || ''}" required></div>
<div class="form-row"><div class="form-group"><label>Edad Mín</label><input name="min_age" type="number" class="form-input" value="${cat.min_age || ''}" required min="0"></div><div class="form-group"><label>Edad Máx</label><input name="max_age" type="number" class="form-input" value="${cat.max_age || ''}" required min="0"></div></div>`;
}

function tourneyFormHTML(t = {}) {
    const catOpts = state.cache.categories.map(c => `<option value="${c.id}" ${t.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    return `<div class="form-group"><label>Nombre</label><input name="name" class="form-input" value="${t.name || ''}" required></div>
<div class="form-group"><label>Abreviatura</label><input name="abbrev" class="form-input" value="${t.abbrev || ''}"></div>
<div class="form-group"><label>Categoría</label><select name="category_id" class="form-input" required>${catOpts}</select></div>
<div class="form-row"><div class="form-group"><label>Año</label><input name="year" type="number" class="form-input" value="${t.year || ''}"></div><div class="form-group"><label><input name="is_event" type="checkbox" ${t.is_event ? 'checked' : ''}> Es Evento</label></div></div>`;
}

function teamFormHTML(t = {}) {
    const catOpts = state.cache.categories.map(c => `<option value="${c.id}" ${t.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    return `<div class="form-group"><label>Nombre</label><input name="name" class="form-input" value="${t.name || ''}" required></div>
<div class="form-group"><label>Abreviatura</label><input name="abbrev" class="form-input" value="${t.abbrev || ''}"></div>
<div class="form-group"><label>Ciudad/Lugar</label><input name="place" class="form-input" value="${t.place || ''}"></div>
<div class="form-group"><label>Categoría</label><select name="category_id" class="form-input" required>${catOpts}</select></div>`;
}

function playerFormHTML(p = {}) {
    const teamOpts = state.cache.teams.map(t => `<option value="${t.id}" ${p.team_id == t.id ? 'selected' : ''}>${t.name}</option>`).join('');
    const posOpts = ['P','C','1B','2B','3B','SS','LF','CF','RF','IF','OF'].map(pos => `<option value="${pos}" ${p.position === pos ? 'selected' : ''}>${pos}</option>`).join('');
    const batsOpts = ['L','R','S'].map(b => `<option value="${b}" ${p.bats === b ? 'selected' : ''}>${b}</option>`).join('');
    const throwsOpts = ['L','R'].map(t => `<option value="${t}" ${p.throws === t ? 'selected' : ''}>${t}</option>`).join('');
    return `<div class="form-row"><div class="form-group"><label>Nombre</label><input name="first_name" class="form-input" value="${p.first_name || ''}" required></div><div class="form-group"><label>Apellido</label><input name="last_name" class="form-input" value="${p.last_name || ''}" required></div></div>
<div class="form-row"><div class="form-group"><label>2do Nombre</label><input name="middle_name" class="form-input" value="${p.middle_name || ''}"></div><div class="form-group"><label>2do Apellido</label><input name="second_last_name" class="form-input" value="${p.second_last_name || ''}"></div></div>
<div class="form-row"><div class="form-group"><label>Posición</label><select name="position" class="form-input">${posOpts}</select></div><div class="form-group"><label>Bate</label><select name="bats" class="form-input">${batsOpts}</select></div><div class="form-group"><label>Tira</label><select name="throws" class="form-input">${throwsOpts}</select></div></div>
<div class="form-row"><div class="form-group"><label>Fecha Nac.</label><input name="dob" type="date" class="form-input" value="${p.dob || ''}"></div><div class="form-group"><label>Equipo</label><select name="team_id" class="form-input"><option value="">Sin equipo</option>${teamOpts}</select></div><div class="form-group"><label>Dorsal</label><input name="jersey_number" type="number" class="form-input" value="${p.jersey_number || ''}" min="0"></div></div>
<div class="form-row"><div class="form-group"><label>Peso (kg)</label><input name="weight_kg" type="number" step="0.1" class="form-input" value="${p.weight_kg || ''}" min="0"></div><div class="form-group"><label>Altura (cm)</label><input name="height_cm" type="number" class="form-input" value="${p.height_cm || ''}" min="0"></div></div>`;
}

function gameFormHTML(g = {}) {
    const tourneyOpts = state.cache.tourneys.map(t => `<option value="${t.id}" ${g.tourney_id == t.id ? 'selected' : ''}>${t.name}</option>`).join('');
    const teamOpts = state.cache.teams.map(t => `<option value="${t.id}" ${g.away_team_id == t.id || g.home_team_id == t.id ? 'selected' : ''}>${t.name}</option>`).join('');
    return `<div class="form-group"><label>Torneo</label><select name="tourney_id" class="form-input" required>${tourneyOpts}</select></div>
<div class="form-row"><div class="form-group"><label>Visitante</label><select name="away_team_id" class="form-input" required>${teamOpts}</select></div><div class="form-group"><label>Local</label><select name="home_team_id" class="form-input" required>${teamOpts}</select></div></div>
<div class="form-row"><div class="form-group"><label>Fecha</label><input name="game_date" type="date" class="form-input" value="${g.game_date || ''}"></div><div class="form-group"><label>Hora</label><input name="game_time" type="time" class="form-input" value="${g.game_time || ''}"></div></div>
<div class="form-group"><label>Estadio</label><input name="venue" class="form-input" value="${g.venue || ''}"></div>
<div class="form-row"><div class="form-group"><label>Entradas</label><input name="innings" type="number" class="form-input" value="${g.innings || 9}" min="1" max="12"></div></div>`;
}

// =========================================
// Tourney Teams Modal
// =========================================
async function openTourneyTeamsModal(tourneyId) {
    const tourney = state.cache.tourneys.find(t => t.id == tourneyId);
    const currentTeams = await api.getTourneyTeams(tourneyId);
    const currentIds = new Set(currentTeams.map(t => t.team_id));
    const availableTeams = state.cache.teams.filter(t => t.category_id === tourney.category_id && !currentIds.has(t.id));

    const html = `
        <h4 style="margin-bottom: 12px;">Equipos en ${tourney.name}</h4>
        <div style="max-height: 300px; overflow: auto;">
            ${state.cache.teams.filter(t => t.category_id === tourney.category_id).map(t => `
                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: var(--radius-sm); margin-bottom: 4px; cursor: pointer;">
                    <input type="checkbox" ${currentIds.has(t.id) ? 'checked' : ''} data-team-id="${t.id}" onchange="toggleTourneyTeam('${tourneyId}', ${t.id}, this.checked)">
                    <span>${t.name} (${t.abbrev || '—'})</span>
                </label>
            `).join('')}
        </div>
    `;
    openModal(`Equipos: ${tourney.name}`, html, async () => {});
}

// Global for checkbox handler
window.toggleTourneyTeam = async (tourneyId, teamId, checked) => {
    if (checked) await api.addTeamToTourney(tourneyId, teamId);
    else await api.removeTeamFromTourney(tourneyId, teamId);
    await loadAllCache();
    toast(checked ? 'Equipo agregado' : 'Equipo removido', 'success');
};

// =========================================
// Scorer Interface
// =========================================
async function openScorer(gameId) {
    state.currentGame = await api.getGame(gameId);
    state.currentGame.events = await api.getEvents(gameId);
    state.currentGame.lineups = await api.getLineups(gameId);
    state.currentGame.pitches = await api.getPitches(gameId);

    const unsubEvents = api.subscribeGameEvents(gameId, payload => handleRealtimeEvent(payload));
    const unsubPitches = api.subscribeGamePitches(gameId, payload => handleRealtimePitch(payload));
    const unsubGame = api.subscribeGame(gameId, payload => handleRealtimeGame(payload));
    state.scorerUnsubs = [unsubEvents, unsubPitches, unsubGame];

    $('#scorer-game-info').textContent = `${state.currentGame.away_team?.name} @ ${state.currentGame.home_team?.name}`;
    $('#scorer-overlay').classList.remove('hidden');
    renderScorer();
}

function closeScorer() {
    state.scorerUnsubs.forEach(unsub => unsub());
    state.scorerUnsubs = [];
    state.currentGame = null;
    $('#scorer-overlay').classList.add('hidden');
}

function handleRealtimeEvent(payload) {
    if (payload.eventType === 'INSERT') {
        state.currentGame.events.push(payload.new);
    } else if (payload.eventType === 'UPDATE') {
        const idx = state.currentGame.events.findIndex(e => e.id === payload.new.id);
        if (idx >= 0) state.currentGame.events[idx] = payload.new;
    } else if (payload.eventType === 'DELETE') {
        state.currentGame.events = state.currentGame.events.filter(e => e.id !== payload.old.id);
    }
    renderScorer();
}

function handleRealtimePitch(payload) {
    if (payload.eventType === 'INSERT') {
        state.currentGame.pitches.push(payload.new);
    }
    renderScorer();
}

function handleRealtimeGame(payload) {
    if (payload.eventType === 'UPDATE') {
        Object.assign(state.currentGame, payload.new);
    }
    renderScorer();
}

function renderScorer() {
    if (!state.currentGame) return;
    const st = computeStateFromEvents(state.currentGame.events, state.currentGame);
    const mode = $('#scorer-view-mode').value;

    let html = '';
    if (mode === 'scoring') html = renderScoringView(st);
    else if (mode === 'lineup') html = renderLineupView();
    else if (mode === 'pitches') html = renderPitchesView();

    $('#scorer-body').innerHTML = html;
}

function renderScoringView(st) {
    const cat = resultCatalogue();
    const playBtns = [
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'hit').map(([k,v]) => ({ code: k, label: v.label, class: 'primary' })),
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'bb' || v.cat === 'hbp' || v.cat === 'ci').map(([k,v]) => ({ code: k, label: v.label, class: 'primary' })),
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'out' && v.batted).map(([k,v]) => ({ code: k, label: v.label })),
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'k').map(([k,v]) => ({ code: k, label: v.label, class: 'danger' })),
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'out' && !v.batted).map(([k,v]) => ({ code: k, label: v.label })),
        ...Object.entries(cat.batting).filter(([k,v]) => v.cat === 'out' && ['SF','SAC'].includes(k)).map(([k,v]) => ({ code: k, label: v.label }))
    ];

    return `
        <div class="scorer-toolbar">
            <div class="scorer-field"><label>Entrada</label><select id="scorer-inning">${Array.from({length: state.currentGame.innings || 9}, (_,i) => `<option value="${i+1}" ${st.inning === i+1 ? 'selected' : ''}>${i+1}</option>`).join('')}</select></div>
            <div class="scorer-field"><label>Mitad</label><select id="scorer-half"><option value="top" ${st.half === 'top' ? 'selected' : ''}>Top (Visita)</option><option value="bottom" ${st.half === 'bottom' ? 'selected' : ''}>Bottom (Local)</option></select></div>
            <div class="scorer-field"><label>Outs</label><select id="scorer-outs"><option value="0" ${st.outs === 0 ? 'selected' : ''}>0</option><option value="1" ${st.outs === 1 ? 'selected' : ''}>1</option><option value="2" ${st.outs === 2 ? 'selected' : ''}>2</option></select></div>
            <div class="scorer-field"><label>Bateador</label><select id="scorer-batter">${buildPlayerOptions('away')}</select></div>
            <div class="scorer-field"><label>Lanzador</label><select id="scorer-pitcher">${buildPlayerOptions('home')}</select></div>
        </div>
        <div class="scorer-grid">
            <div class="scorer-main">
                <div class="scoreboard">
                    <div class="team-score"><div class="team-name">${state.currentGame.away_team?.name}</div><div class="team-runs">${st.score.away}</div></div>
                    <div class="scoreboard-center"><div class="inning-display">${st.inning} ${st.half === 'top' ? '▲' : '▼'}</div><div class="outs-display">${st.outs} Out${st.outs !== 1 ? 's' : ''}</div></div>
                    <div class="team-score"><div class="team-name">${state.currentGame.home_team?.name}</div><div class="team-runs">${st.score.home}</div></div>
                </div>
                <div class="base-state">
                    <div class="base ${st.bases['1'] ? '' : 'empty'}"><div class="base-label">1B</div><div class="base-runner">${st.bases['1'] ? playerName(st.bases['1']) : '—'}</div></div>
                    <div class="base ${st.bases['2'] ? '' : 'empty'}"><div class="base-label">2B</div><div class="base-runner">${st.bases['2'] ? playerName(st.bases['2']) : '—'}</div></div>
                    <div class="base ${st.bases['3'] ? '' : 'empty'}"><div class="base-label">3B</div><div class="base-runner">${st.bases['3'] ? playerName(st.bases['3']) : '—'}</div></div>
                </div>
                <div class="line-score">${buildLineScoreTable(st)}</div>
                <h4 style="padding: 0 16px 8px; color: var(--text-muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">JUGADAS</h4>
                <div class="play-grid">${playBtns.map(p => `<button class="play-btn ${p.class || ''}" data-play="${p.code}" title="${p.label}"><span class="play-code">${p.code}</span><span class="play-label">${p.label}</span></button>`).join('')}</div>
                <h4 style="padding: 0 16px 8px; color: var(--text-muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">BASERUNNING</h4>
                <div class="play-grid">${Object.entries(cat.baserunning).map(([k,v]) => `<button class="play-btn" data-play="${k}" data-kind="BR" title="${v.label}"><span class="play-code">${k}</span><span class="play-label">${v.label}</span></button>`).join('')}</div>
                <h4 style="padding: 0 16px 8px; color: var(--text-muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">SUSTITUCIONES</h4>
                <div class="play-grid"><button class="play-btn" data-action="sub" title="Sustitución"><span class="play-code">SUB</span><span class="play-label">Sub</span></button></div>
            </div>
            <div class="scorer-sidebar">
                <div class="lineup-panel"><h4>Visitante</h4>${buildLineupList('away')}</div>
                <div class="lineup-panel"><h4>Local</h4>${buildLineupList('home')}</div>
                <div class="lineup-panel"><h4>Log de Jugadas</h4><div class="event-log">${buildEventLog(st)}</div></div>
            </div>
        </div>`;
}

function buildPlayerOptions(side) {
    const teamId = side === 'away' ? state.currentGame.away_team_id : state.currentGame.home_team_id;
    const players = state.cache.players.filter(p => p.team_id === teamId);
    return players.map(p => `<option value="${p.id}">${p.jersey_number ? `#${p.jersey_number} ` : ''}${p.first_name} ${p.last_name} (${p.position || '—'})</option>`).join('');
}

function buildLineupList(side) {
    const lineups = state.currentGame.lineups.filter(l => l.side === side && l.active).sort((a,b) => (a.batting_order || 0) - (b.batting_order || 0));
    return `<div class="lineup-list">${lineups.map(l => `
        <div class="lineup-slot ${l.is_starter ? 'starter' : 'sub'}">
            <span class="slot-order">${l.batting_order || '—'}</span>
            <span class="slot-name">${playerName(l.player_id)}</span>
            <span class="slot-pos">${l.position || '—'}</span>
            <span class="slot-actions"><button class="action-btn" data-action="sub-player" data-lineup-id="${l.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button></span>
        </div>`).join('')}</div>`;
}

function buildEventLog(st) {
    return state.currentGame.events.slice().reverse().map(e => `
        <div class="event-entry">
            <span class="event-seq">${e.seq}</span>
            <span class="event-inning">${e.inning}${e.half === 'top' ? '▲' : '▼'}</span>
            <span class="event-desc">${e.description || formatEventDesc(e)}</span>
            <span class="event-result">${e.result || ''}</span>
        </div>
    `).join('');
}

function playerName(id) {
    const p = state.cache.players.find(x => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : `#${id}`;
}

function formatEventDesc(e) {
    const batter = playerName(e.batter_id);
    const pitcher = playerName(e.pitcher_id);
    if (e.kind === 'PA') return `${batter} vs ${pitcher}: ${e.result}${e.detail ? ' ' + e.detail : ''}`;
    if (e.kind === 'BR') return `${playerName(e.runner_id)}: ${e.result}`;
    if (e.kind === 'SUB') return `Sub: ${e.description}`;
    return e.description || e.kind;
}

function buildLineScoreTable(st) {
    const line = st.line || {};
    const innings = Object.keys(line).map(Number).sort((a,b) => a-b);
    const totals = { away: st.score.away, home: st.score.home };
    const hdr = '<th>Equipo</th>' + innings.map(i => `<th>${i}</th>`).join('') + '<th>R</th><th>H</th><th>E</th>';
    const row = (side, name, scoreKey) => `<tr><td class="tm">${name}</td>` + innings.map(i => `<td>${line[i]?.[side === 'away' ? 'top' : 'bottom'] ?? ''}</td>`).join('') + `<td>${totals[scoreKey]}</td><td>${st.hits[scoreKey]}</td><td>${st.errors[scoreKey]}</td></tr>`;
    return `<table class="line-score"><thead><tr>${hdr}</tr></thead><tbody>${row('top', state.currentGame.away_team?.name, 'away')}${row('bottom', state.currentGame.home_team?.name, 'home')}</tbody></table>`;
}

function renderLineupView() {
    // Simplified lineup editor
    return `<div style="padding: 20px;"><h4>Alineaciones - En desarrollo</h4></div>`;
}

function renderPitchesView() {
    const pitches = state.currentGame.pitches || [];
    return `
        <div class="scorer-toolbar">
            <h4 style="margin: 0; color: var(--text-secondary);">Lanzamientos: ${pitches.length}</h4>
        </div>
        <div class="scorer-grid">
            <div class="scorer-main">
                ${buildPitchZoneGrid(pitches)}
                ${buildChaseZones(pitches)}
            </div>
            <div class="scorer-sidebar">
                <h4>Detalle</h4>
                <div style="max-height: 400px; overflow: auto;">${pitches.slice().reverse().map(p => `
                    <div style="padding: 8px; border-bottom: 1px solid var(--border-primary); font-size: 12px;">
                        <strong>${p.pitch_type || '—'}</strong> Zona ${p.zone} • ${p.velocity || '—'} mph • ${p.result}
                    </div>
                `).join('')}</div>
            </div>
        </div>`;
}

// =========================================
// Game Report Viewer
// =========================================
async function viewGameReport(gameId) {
    try {
        const game = await api.getGame(gameId);
        const events = await api.getEvents(gameId);
        const state = computeStateFromEvents(events, game);
        const lineups = await api.getLineups(gameId);
        const posmap = fieldingPosMap(lineups);

        // Build box scores
        const awayBox = await buildBoxScore(api, game, events, posmap, 'away');
        const homeBox = await buildBoxScore(api, game, events, posmap, 'home');

        const heatmapSVG = buildHeatmapSVG(await zoneHeatmap(gameId));
        const spraySVG = buildSpraySVG(await sprayChart(gameId));

        const html = buildGameReportHTML(game, state, awayBox, homeBox, heatmapSVG, spraySVG);

        // Open in new window
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
    } catch (err) {
        toast(err.message, 'error', 'Error generando reporte');
    }
}

async function buildBoxScore(api, game, events, posmap, side) {
    // Simplified - in reality would compute full box
    return { batting: [], pitching: [] };
}

async function zoneHeatmap(gameId) {
    const pitches = await api.getPitches(gameId);
    const zones = {};
    for (const zn of [1,2,3,4,5,6,7,8,9,11,12,13,14]) zones[zn] = { pitches: 0, strikes: 0, swings: 0, whiffs: 0, balls: 0 };
    let total = { pitches: 0, strikes: 0, swings: 0, whiffs: 0, balls: 0 };
    for (const p of pitches) {
        const z = zones[p.zone] || zones[p.zone.toString()] || { pitches: 0, strikes: 0, swings: 0, whiffs: 0, balls: 0 };
        z.pitches++; total.pitches++;
        if (p.is_strike) { z.strikes++; total.strikes++; }
        if (p.is_swing) { z.swings++; total.swings++; }
        if (p.result === 'SS') { z.whiffs++; total.whiffs++; }
        if (p.result === 'B') { z.balls++; total.balls++; }
    }
    const peak = Math.max(...Object.values(zones).map(z => z.pitches), 1);
    for (const z of Object.values(zones)) {
        z.pct = z.pitches / total.pitches || 0;
        z.strike_pct = z.pitches ? z.strikes / z.pitches : 0;
        z.intensity = z.pitches / peak;
    }
    return { zones, total, peak, avg_velo: null, pitch_types: {}, strike_pct: total.strikes/total.pitches||0, swing_pct: total.swings/total.pitches||0, whiff_pct: total.whiffs/total.swings||0 };
}

async function sprayChart(gameId) {
    return { points: [], total: 0, counts: { hit: 0, out: 0, other: 0 } };
}

function fieldingPosMap(lineups) {
    const out = { away: {}, home: {} };
    for (const l of lineups) {
        if (!l.active) continue;
        const num = { 'P': 1, 'C': 2, '1B': 3, '2B': 4, '3B': 5, 'SS': 6, 'LF': 7, 'CF': 8, 'RF': 9 }[l.position];
        if (num) out[l.side][num] = l.player_id;
    }
    return out;
}

// =========================================
// Stats Export Handlers
// =========================================
$('#btn-stats-export-html')?.addEventListener('click', async () => {
    try {
        const data = await stats(api, {
            categoryId: state.filters.statsCategory || null,
            tourneyId: state.filters.statsTourney || null,
            teamId: state.filters.statsTeam || null
        });
        const html = buildStatsHTML(data, {
            category: state.filters.statsCategory ? catName(parseInt(state.filters.statsCategory)) : '',
            tourney: state.filters.statsTourney ? tourneyName(parseInt(state.filters.statsTourney)) : '',
            team: state.filters.statsTeam ? teamName(parseInt(state.filters.statsTeam)) : '',
            tab: state.filters.statsTab,
            level: state.filters.statsLevel
        });
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${state.filters.statsTab}_${new Date().toISOString().slice(0,10)}.html`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, 'error'); }
});

$('#btn-stats-export-pdf')?.addEventListener('click', async () => {
    try {
        const data = await stats(api, {
            categoryId: state.filters.statsCategory || null,
            tourneyId: state.filters.statsTourney || null,
            teamId: state.filters.statsTeam || null
        });
        const blob = await generateStatsPDF(data, {
            category: state.filters.statsCategory ? catName(parseInt(state.filters.statsCategory)) : '',
            tourney: state.filters.statsTourney ? tourneyName(parseInt(state.filters.statsTourney)) : '',
            team: state.filters.statsTeam ? teamName(parseInt(state.filters.statsTeam)) : '',
            tab: state.filters.statsTab,
            level: state.filters.statsLevel
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${state.filters.statsTab}_${new Date().toISOString().slice(0,10)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, 'error'); }
});

// =========================================
// Import/Export Handlers
// =========================================
$('#btn-export')?.addEventListener('click', () => exportSession(api));
$('#btn-export-data')?.addEventListener('click', () => exportSession(api));
$('#btn-import-data')?.addEventListener('click', () => $('#import-file').click());
$('#import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const result = await importSession(api, file);
        toast(`Importado: ${Object.entries(result.loaded).map(([k,v]) => `${k}:${v}`).join(', ')}`, 'success');
        await loadAllCache();
    } catch (err) {
        toast(err.message, 'error', 'Error importando');
    }
    e.target.value = '';
});

// =========================================
// Settings
// =========================================
$('#btn-test-connection')?.addEventListener('click', async () => {
    const url = $('#supabase-url').value.trim();
    const key = $('#supabase-key').value.trim();
    if (!url || !key) { toast('Ingrese URL y Key', 'error'); return; }
    try {
        const testApi = new (await import('./api.js')).SupabaseAPI();
        testApi.init(url, key);
        const { error } = await testApi.supabase.from('categories').select('count').limit(1);
        if (error) throw error;
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_key', key);
        api.init(url, key);
        state.supabaseConnected = true;
        updateConnectionStatus(true);
        $('#connection-test-result').textContent = '✓ Conexión exitosa';
        $('#connection-test-result').className = 'status-text success';
        await loadAllCache();
    } catch (err) {
        $('#connection-test-result').textContent = '✗ ' + err.message;
        $('#connection-test-result').className = 'status-text error';
    }
});

// Load saved credentials
$('#supabase-url').value = localStorage.getItem('supabase_url') || '';
$('#supabase-key').value = localStorage.getItem('supabase_key') || '';

// =========================================
// Filter Handlers
// =========================================
$('#filter-tourney-category')?.addEventListener('change', e => { state.filters.tourneyCategory = e.target.value; renderTourneys(); });
$('#filter-team-category')?.addEventListener('change', e => { state.filters.teamCategory = e.target.value; renderTeams(); });
$('#filter-player-team')?.addEventListener('change', e => { state.filters.playerTeam = e.target.value; renderPlayers(); });
$('#filter-game-tourney')?.addEventListener('change', e => { state.filters.gameTourney = e.target.value; renderGames(); });
$('#filter-game-status')?.addEventListener('change', e => { state.filters.gameStatus = e.target.value; renderGames(); });
$('#stats-scope-category')?.addEventListener('change', e => { state.filters.statsCategory = e.target.value; renderStats(); });
$('#stats-scope-tourney')?.addEventListener('change', e => { state.filters.statsTourney = e.target.value; renderStats(); });
$('#stats-scope-team')?.addEventListener('change', e => { state.filters.statsTeam = e.target.value; renderStats(); });
$('#stats-tab')?.addEventListener('change', e => { state.filters.statsTab = e.target.value; renderStats(); });
$('#stats-level')?.addEventListener('change', e => { state.filters.statsLevel = e.target.value; renderStats(); });

// =========================================
// Navigation
// =========================================
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

// Modal close
$('.modal-close')?.addEventListener('click', closeModal);
$('.modal-cancel')?.addEventListener('click', closeModal);
modalOverlay?.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// Scorer close
$('#scorer-overlay .modal-close')?.addEventListener('click', closeScorer);
$('#scorer-view-mode')?.addEventListener('change', renderScorer);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeScorer(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); toast('Deshacer - pendiente', 'info'); }
});

// =========================================
// Initialize
// =========================================
async function init() {
    setupModals();
    await initSupabase();
    showView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.DiamondScorer = { api, state, openScorer, closeScorer };