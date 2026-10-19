/**
 * Report Generators: HTML + PDF (via jsPDF)
 */

import { buildHeatmapSVG, buildSpraySVG } from './viz.js';
import { computeStateFromEvents } from './stats.js';

// Column definitions
const BAT_COLS = {
    basic: [['G','G'],['PA','PA'],['AB','AB'],['R','R'],['H','H'],['HR','HR'],['RBI','RBI'],['BB','BB'],['SO','SO'],['AVG','AVG',1],['OBP','OBP',1],['SLG','SLG',1],['OPS','OPS',1]],
    advanced: [['2B','2B'],['3B','3B'],['SB','SB'],['CS','CS'],['TB','TB'],['ISO','ISO',1],['BB%','BB%',1],['K%','K%',1]],
    detailed: [['IBB','IBB'],['HBP','HBP'],['SF','SF'],['SAC','SAC'],['BABIP','BABIP',1],['SB%','SB%',1]]
};

const PIT_COLS = {
    basic: [['G','G'],['W','W'],['L','L'],['SV','SV'],['IP','IP'],['H','H'],['R','R'],['ER','ER'],['BB','BB'],['SO','SO'],['ERA','ERA',2],['WHIP','WHIP',2]],
    advanced: [['HR','HR'],['HBP','HBP'],['K9','K/9',2],['BB9','BB/9',2],['KBB','K/BB',2],['RA9','RA/9',2]],
    detailed: [['BF','BF'],['Pit','Pit'],['Str%','Str%',1],['Sw%','Sw%',1],['Whiff%','Whiff%',1],['IBB','IBB']]
};

const FLD_COLS = {
    basic: [['G','G'],['PO','PO'],['A','A'],['E','E'],['DP','DP'],['FPCT','FPCT',1]],
    advanced: [['TC','TC'],['cCS','CS'],['cSB','SB'],['CS%','CS%',1],['cPB','PB']],
    detailed: [['cPO','PO(C)'],['pWP','WP'],['pPO','PO(P)']]
};

const STAND_COLS = [['GP','GP'],['W','W'],['L','L'],['T','T'],['PCT','PCT',1],['RF','RF'],['RA','RA'],['DIFF','DIFF']];

function fmt(v, rate) {
    if (v == null || v === '') return '';
    if (rate === 1) { const f = parseFloat(v); if (isNaN(f)) return v; const s = f.toFixed(3); return f < 1 && f >= 0 ? s.slice(1) : s; }
    if (rate === 2) { const f = parseFloat(v); if (isNaN(f)) return v; return f.toFixed(2); }
    return String(v);
}

function statCols(tab, level) {
    const src = { batting: BAT_COLS, pitching: PIT_COLS, fielding: FLD_COLS }[tab] || BAT_COLS;
    let cols = [...src.basic];
    if (level !== 'basic') cols.push(...src.advanced);
    if (level === 'detailed') cols.push(...src.detailed);
    return cols;
}

function scopeLine(team, level, gc) {
    const bits = [team || 'All Teams'];
    if (level) bits.push(level.charAt(0).toUpperCase() + level.slice(1) + ' view');
    bits.push(`${gc} game${gc === 1 ? '' : 's'}`);
    return bits.join(' · ');
}

/**
 * Build printable HTML report for a single game
 */
export function buildGameReportHTML(game, state, awayBox, homeBox, heatmapSVG, spraySVG) {
    const title = `${game.away_name} @ ${game.home_name}`;
    const sub = [game.game_date, game.venue].filter(Boolean).join(' · ');

    function boxTable(rows, cols) {
        if (!rows?.length) return '<p class="nodata">No data.</p>';
        const head = '<th class="l">Player</th>' + cols.map(([,l]) => `<th>${l}</th>`).join('');
        const body = rows.map(r => `<tr><td class="l">${r.name}</td>` + cols.map(([k]) => `<td>${fmt(r[k], 0)}</td>`).join('') + '</tr>').join('');
        return `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function lineTable() {
        const line = state.line || {};
        const innings = Object.keys(line).map(Number).sort((a,b) => a-b);
        const totals = state.totals || { away: {}, home: {} };
        const hdr = innings.map(i => `<th>${i}</th>`).join('');
        const row = (side, name) => {
            const per = line[side] || {};
            const t = totals[side] || {};
            return `<tr><td class="l tm">${name}</td>` + innings.map(i => `<td>${per[i] ?? ''}</td>`).join('') + `<td>${t.R ?? 0}</td><td>${t.H ?? 0}</td><td>${t.E ?? 0}</td></tr>`;
        };
        return `<table class="line-score"><thead><tr><th class="tm">Team</th>${hdr}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${row('top', game.away_name)}${row('bottom', game.home_name)}</tbody></table>`;
    }

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${title} — Diamond Scorer</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: #070d18; color: #eaf1fb; padding: 28px; }
.wrap { max-width: 960px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 2px; }
.sub { color: #6f86a8; font-size: 14px; margin-bottom: 22px; }
.line-score { border-collapse: collapse; margin: 0 0 26px; font-variant-numeric: tabular-nums; font-size: 13px; }
.line-score th, .line-score td { border: 1px solid #1e3050; padding: 6px 10px; text-align: center; }
.line-score th { color: #6f86a8; background: #0f1b2e; }
.line-score td.tm { text-align: left; font-weight: 600; }
.viz { display: flex; gap: 26px; flex-wrap: wrap; margin: 0 0 26px; }
.viz-card { background: #0f1b2e; border: 1px solid #1e3050; border-radius: 12px; padding: 16px; flex: 1; min-width: 320px; }
.viz-card h2 { font-size: 15px; margin: 0 0 12px; }
.report-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.report-table th, .report-table td { padding: 7px 9px; border-bottom: 1px solid #1e3050; text-align: right; }
.report-table th { color: #6f86a8; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
.report-table th.l, .report-table td.l { text-align: left; }
.side { margin: 0 0 22px; }
.side h2 { font-size: 15px; margin: 18px 0 8px; color: #4d94ff; }
.foot { color: #6f86a8; font-size: 11px; margin-top: 24px; border-top: 1px solid #1e3050; padding-top: 12px; }
@media print { body { background: white; color: #1a1a2e; padding: 0; } .wrap { max-width: none; } .foot { display: none; } }
</style></head><body><div class="wrap">
<h1>${title}</h1><div class="sub">${sub}</div>
${lineTable()}
<div class="viz">
  <div class="viz-card"><h2>Strike-zone Heatmap</h2>${heatmapSVG}</div>
  <div class="viz-card"><h2>Spray Chart</h2>${spraySVG}</div>
</div>
<div class="side"><h2>${game.away_name} — Batting</h2>${boxTable(awayBox.batting, BAT_COLS.basic)}<h2>${game.away_name} — Pitching</h2>${boxTable(awayBox.pitching, PIT_COLS.basic)}</div>
<div class="side"><h2>${game.home_name} — Batting</h2>${boxTable(homeBox.batting, BAT_COLS.basic)}<h2>${game.home_name} — Pitching</h2>${boxTable(homeBox.pitching, PIT_COLS.basic)}</div>
<div class="foot">Generated by Diamond Scorer</div>
</div></body></html>`;
}

/**
 * Build statistics HTML report
 */
export function buildStatsHTML(data, options = {}) {
    const { batting, pitching, fielding, standings, game_count } = data;
    const { category, tourney, team, tab = 'batting', level = 'basic' } = options;

    function statTable(players, cols) {
        if (!players?.length) return '<p class="nodata">No qualifying players.</p>';
        const head = '<th class="l">Player</th><th class="l">Tm</th>' + cols.map(([,l]) => `<th>${l}</th>`).join('');
        const body = players.map(r => `<tr><td class="l">${r.name}</td><td class="l">${r.team || ''}</td>` + cols.map(([k, , rt]) => `<td>${fmt(r[k], rt)}</td>`).join('') + '</tr>').join('');
        return `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function standTable() {
        if (!standings?.length) return '<p class="nodata">No completed games.</p>';
        const head = '<th class="l">#</th><th class="l">Team</th>' + STAND_COLS.map(([,l]) => `<th>${l}</th>`).join('');
        const body = standings.map((r, i) => `<tr><td class="l">${i+1}</td><td class="l">${r.team}</td>` + STAND_COLS.map(([k, , rt]) => `<td>${fmt(r[k], rt)}</td>`).join('') + '</tr>').join('');
        return `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    const cols = statCols(tab, level);
    const title = { batting: 'Batting', pitching: 'Pitching', fielding: 'Fielding', standings: 'Standings' }[tab];
    const teamName = team || (options.teamObj ? options.teamObj.name : 'All Teams');

    let body = '';
    if (tab === 'standings') body = standTable();
    else if (tab === 'all') {
        body = ['batting', 'pitching', 'fielding'].map(t => `<div class="sect"><div class="sect-title">${t.toUpperCase()}</div><div class="card2">${statTable(data[t], statCols(t, level))}</div></div>`).join('');
    } else {
        body = statTable(data[tab], cols);
    }

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${title} Statistics — Diamond Scorer</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: #070d18; color: #eaf1fb; padding: 28px; }
.wrap { max-width: 1000px; margin: 0 auto; }
.rep-header { text-align: center; margin: 0 0 24px; padding: 4px 0 20px; border-bottom: 2px solid #1e3050; }
.rep-header .rh-line { font-size: 15px; color: #a8bbd6; line-height: 1.55; }
.rep-header .rh-title { margin-top: 18px; font-size: 27px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #4d94ff; }
.rep-header .rh-scope { margin-top: 10px; font-size: 12px; color: #6f86a8; text-transform: uppercase; letter-spacing: 1px; }
.sect { margin: 0 0 30px; }
.sect .sect-title { text-align: center; font-size: 20px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #4d94ff; margin: 0 0 14px; }
.card2 { background: #0f1b2e; border: 1px solid #1e3050; border-radius: 14px; padding: 18px 20px; }
.report-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.report-table th, .report-table td { padding: 6px 8px; border: 1px solid #c3cfe0; text-align: right; }
.report-table th { background: #1c4f8f; color: white; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
.report-table th.l, .report-table td.l { text-align: left; }
.report-table tbody tr:nth-child(even) { background: #f2f6fc; }
.foot { color: #6f86a8; font-size: 11px; margin-top: 24px; border-top: 1px solid #1e3050; padding-top: 12px; text-align: center; }
@media print { body { background: white; color: #1a1a2e; } .report-table th { background: #1c4f8f !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body><div class="wrap">
<div class="rep-header">
  ${category ? `<div class="rh-line lead">${category}</div>` : ''}
  ${tourney ? `<div class="rh-line">${tourney}</div>` : ''}
  <div class="rh-line">${teamName}</div>
  <div class="rh-title">${title} STATISTICS</div>
  <div class="rh-scope">${scopeLine(teamName, level, game_count)}</div>
</div>
${body}
<div class="foot">Generated by Diamond Scorer — statistics derived live from play-by-play log</div>
</div></body></html>`;
}

/**
 * Generate PDF using jsPDF + autoTable
 */
export async function generateGameReportPDF(game, state, awayBox, homeBox, heatmapSVG, spraySVG) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const title = `${game.away_name} @ ${game.home_name}`;
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    const sub = [game.game_date, game.venue].filter(Boolean).join(' · ');
    doc.text(sub, 105, 27, { align: 'center' });

    // Line score
    const line = state.line || {};
    const innings = Object.keys(line).map(Number).sort((a,b) => a-b);
    const totals = state.totals || { away: {}, home: {} };
    const header = ['Team', ...innings.map(String), 'R', 'H', 'E'];
    const row = (side, name) => {
        const per = line[side] || {};
        const t = totals[side] || {};
        return [name, ...innings.map(i => per[i] ?? ''), t.R ?? 0, t.H ?? 0, t.E ?? 0];
    };
    doc.autoTable({
        startY: 35,
        head: [header],
        body: [row('top', game.away_name), row('bottom', game.home_name)],
        theme: 'grid',
        headStyles: { fillColor: [28, 79, 143], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 2, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
    });

    // Heatmap + Spray (as images)
    // Note: Would need to convert SVG to image first
    // For now, skip visualizations in PDF

    // Box scores
    const y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`${game.away_name} — Batting`, 14, y);
    doc.autoTable({
        startY: y + 5,
        head: [['Player', ...BAT_COLS.basic.map(([,l]) => l)]],
        body: awayBox.batting.map(r => [r.name, ...BAT_COLS.basic.map(([k]) => fmt(r[k], 0))]),
        theme: 'grid',
        headStyles: { fillColor: [28, 79, 143], textColor: 255 },
        styles: { fontSize: 7.5, cellPadding: 1.5 }
    });

    doc.setFontSize(14);
    doc.text(`${game.away_name} — Pitching`, 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Player', ...PIT_COLS.basic.map(([,l]) => l)]],
        body: awayBox.pitching.map(r => [r.name, ...PIT_COLS.basic.map(([k]) => fmt(r[k], 0))]),
        theme: 'grid',
        headStyles: { fillColor: [28, 79, 143], textColor: 255 },
        styles: { fontSize: 7.5, cellPadding: 1.5 }
    });

    // Home team
    doc.setFontSize(14);
    doc.text(`${game.home_name} — Batting`, 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Player', ...BAT_COLS.basic.map(([,l]) => l)]],
        body: homeBox.batting.map(r => [r.name, ...BAT_COLS.basic.map(([k]) => fmt(r[k], 0))]),
        theme: 'grid',
        headStyles: { fillColor: [28, 79, 143], textColor: 255 },
        styles: { fontSize: 7.5, cellPadding: 1.5 }
    });

    doc.setFontSize(14);
    doc.text(`${game.home_name} — Pitching`, 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Player', ...PIT_COLS.basic.map(([,l]) => l)]],
        body: homeBox.pitching.map(r => [r.name, ...PIT_COLS.basic.map(([k]) => fmt(r[k], 0))]),
        theme: 'grid',
        headStyles: { fillColor: [28, 79, 143], textColor: 255 },
        styles: { fontSize: 7.5, cellPadding: 1.5 }
    });

    return doc.output('blob');
}

export async function generateStatsPDF(data, options = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });

    const { batting, pitching, fielding, standings, game_count } = data;
    const { category, tourney, team, tab = 'batting', level = 'basic' } = options;

    doc.setFontSize(17);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(11, 31, 58);
    if (category) { doc.text(category, 148, 15, { align: 'center' }); }
    if (tourney) { doc.setFontSize(12); doc.setTextColor(68, 88, 111); doc.text(tourney, 148, 22, { align: 'center' }); }
    doc.setFontSize(12);
    doc.setTextColor(68, 88, 111);
    doc.text(team || 'All Teams', 148, category || tourney ? 29 : 22, { align: 'center' });

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(28, 79, 143);
    const title = { batting: 'BATTING', pitching: 'PITCHING', fielding: 'FIELDING', standings: 'STANDINGS' }[tab];
    doc.text(`${title} STATISTICS`, 148, 38, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(122, 138, 160);
    doc.text(scopeLine(team, level, game_count), 148, 44, { align: 'center' });

    doc.setDrawColor(195, 207, 224);
    doc.line(14, 46, 283, 46);

    const cols = statCols(tab, level);
    const startY = 50;

    if (tab === 'standings') {
        doc.autoTable({
            startY,
            head: [['#', 'Team', ...STAND_COLS.map(([,l]) => l)]],
            body: standings.map((r, i) => [String(i+1), r.team, ...STAND_COLS.map(([k, , rt]) => fmt(r[k], rt))]),
            theme: 'grid',
            headStyles: { fillColor: [28, 79, 143], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            columnStyles: { 0: { halign: 'center' }, 1: { halign: 'left' } }
        });
    } else if (tab === 'all') {
        let y = startY;
        for (const t of ['batting', 'pitching', 'fielding']) {
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(28, 79, 143);
            doc.text(t.toUpperCase(), 14, y);
            y += 6;
            const tcols = statCols(t, level);
            doc.autoTable({
                startY: y,
                head: [['Player', 'Tm', ...tcols.map(([,l]) => l)]],
                body: data[t].map(r => [r.name, r.team || '', ...tcols.map(([k, , rt]) => fmt(r[k], rt))]),
                theme: 'grid',
                headStyles: { fillColor: [28, 79, 143], textColor: 255 },
                styles: { fontSize: 7, cellPadding: 1.5 },
                columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } },
                didDrawPage: (data) => { y = data.cursor.y + 6; }
            });
        }
    } else {
        doc.autoTable({
            startY,
            head: [['Player', 'Tm', ...cols.map(([,l]) => l)]],
            body: data[tab].map(r => [r.name, r.team || '', ...cols.map(([k, , rt]) => fmt(r[k], rt))]),
            theme: 'grid',
            headStyles: { fillColor: [28, 79, 143], textColor: 255 },
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } }
        });
    }

    return doc.output('blob');
}