/**
 * Visualizations: Strike-zone Heatmap & Spray Chart
 * SVG-based, no external dependencies
 */

import { ALL_ZONES } from './scoring.js';

// Strike-zone coordinates (catcher's view)
const ZONE_COORDS = {
    1: { x: 0, y: 0 }, 2: { x: 1, y: 0 }, 3: { x: 2, y: 0 },
    4: { x: 0, y: 1 }, 5: { x: 1, y: 1 }, 6: { x: 2, y: 1 },
    7: { x: 0, y: 2 }, 8: { x: 1, y: 2 }, 9: { x: 2, y: 2 },
    11: { x: -0.5, y: -0.5 }, 12: { x: 2.5, y: -0.5 },
    13: { x: -0.5, y: 2.5 }, 14: { x: 2.5, y: 2.5 }
};

/**
 * Build strike-zone heatmap SVG
 */
export function buildHeatmapSVG(hm, width = 320) {
    if (!hm?.total?.pitches || hm.total.pitches === 0) {
        return `<svg viewBox="0 0 ${width} ${width}" class="heatmap-svg"><text x="50%" y="50%" text-anchor="middle" fill="#6f86a8" font-size="14">No pitch data</text></svg>`;
    }

    const z = hm.zones;
    const pad = 40;
    const cell = (width - 2 * pad) / 3;
    const peak = hm.peak || 1;

    function heatColor(intensity) {
        const hue = 220 - 210 * intensity;
        return `hsl(${hue}, 82%, 52%)`;
    }

    function cellSVG(zn, cx, cy) {
        const d = z[zn] || z[zn.toString()] || { pitches: 0, strike_pct: 0, intensity: 0 };
        const fill = heatColor(d.intensity || 0);
        const pct = d.pitches ? Math.round(d.strike_pct * 100) : 0;
        const n = d.pitches || 0;
        return `
            <rect x="${cx}" y="${cy}" width="${cell}" height="${cell}"
                  fill="${fill}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
            ${n ? `<text x="${cx + cell/2}" y="${cy + cell/2 - 4}" text-anchor="middle" fill="#eaf1fb" font-size="14" font-weight="700" font-family="JetBrains Mono">${n}</text>` : ''}
            ${n ? `<text x="${cx + cell/2}" y="${cy + cell/2 + 12}" text-anchor="middle" fill="#a8bbd6" font-size="10">${pct}%</text>` : ''}
        `;
    }

    let svg = `<svg viewBox="0 0 ${width} ${width}" class="heatmap-svg" width="${width}" height="${width}">`;
    svg += `<rect x="0" y="0" width="${width}" height="${width}" fill="#111c30" stroke="#1e3050" rx="8"/>`;

    // Chase zones (corners)
    const chaseZones = [
        { zn: 11, x: 4, y: 4 }, { zn: 12, x: width - pad + 2, y: 4 },
        { zn: 13, x: 4, y: width - pad + 2 }, { zn: 14, x: width - pad + 2, y: width - pad + 2 }
    ];
    for (const cz of chaseZones) {
        const d = z[cz.zn] || z[cz.zn.toString()] || { pitches: 0, strike_pct: 0, intensity: 0 };
        const fill = heatColor(d.intensity || 0);
        const pct = d.pitches ? Math.round(d.strike_pct * 100) : 0;
        const n = d.pitches || 0;
        const sz = pad - 8;
        svg += `<rect x="${cz.x}" y="${cz.y}" width="${sz}" height="${sz}" fill="${fill}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
        if (n) {
            svg += `<text x="${cz.x + sz/2}" y="${cz.y + sz/2 - 3}" text-anchor="middle" fill="#eaf1fb" font-size="11" font-weight="700" font-family="JetBrains Mono">${n}</text>`;
            svg += `<text x="${cz.x + sz/2}" y="${cz.y + sz/2 + 10}" text-anchor="middle" fill="#a8bbd6" font-size="9">${pct}%</text>`;
        }
    }

    // Core 3x3
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const zn = row * 3 + col + 1;
            const cx = pad + col * cell;
            const cy = pad + row * cell;
            svg += cellSVG(zn, cx, cy);
        }
    }

    // Strike zone border
    svg += `<rect x="${pad}" y="${pad}" width="${3*cell}" height="${3*cell}" fill="none" stroke="#294066" stroke-width="2"/>`;
    // Home plate
    svg += `<polygon points="${width/2 - 20},${width - 18} ${width/2 + 20},${width - 18} ${width/2 + 20},${width - 10} ${width/2},${width - 2} ${width/2 - 20},${width - 10}" fill="#13223a" stroke="#294066"/>`;

    svg += '</svg>';
    return svg;
}

/**
 * Build spray chart SVG
 */
export function buildSpraySVG(sp, width = 400) {
    if (!sp?.total || sp.total === 0) {
        return `<svg viewBox="0 0 ${width} ${width * 0.94}" class="spray-svg"><text x="50%" y="50%" text-anchor="middle" fill="#6f86a8" font-size="14">No batted-ball data</text></svg>`;
    }

    const W = width;
    const H = Math.round(width * 0.94);
    const hx = W * 0.5;
    const hy = H * 0.95;

    const SPRAY_COLORS = { hit: '#35d07f', out: '#ff5470', other: '#ffc857' };

    function polar(ang, rad) {
        const r = ang * Math.PI / 180;
        return { x: hx + rad * 0.62 * W * Math.sin(r), y: hy - rad * 0.90 * H * Math.cos(r) };
    }

    // Field boundaries
    const lf = polar(-48, 1.05);
    const cf = polar(0, 1.08);
    const rf = polar(48, 1.05);
    const b1 = polar(45, 0.42);
    const b2 = polar(0, 0.52);
    const b3 = polar(-45, 0.42);
    const g1 = polar(45, 0.30);
    const g2 = polar(0, 0.40);
    const g3 = polar(-45, 0.30);
    const mound = polar(0, 0.30);

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="spray-svg" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet">`;
    svg += `<defs><radialGradient id="grass" cx="50%" cy="90%" r="95%"><stop offset="0%" stop-color="#1c5b34"/><stop offset="100%" stop-color="#0f3d22"/></radialGradient></defs>`;
    svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#08131f" stroke="#1e3050" rx="12"/>`;
    // Outfield grass
    svg += `<path d="M${hx},${hy} L${lf.x},${lf.y} Q${cf.x},${cf.y - 24} ${rf.x},${rf.y} Z" fill="url(#grass)" stroke="#2f7d4c"/>`;
    // Infield dirt
    svg += `<polygon points="${hx},${hy} ${b1.x},${b1.y} ${b2.x},${b2.y} ${b3.x},${b3.y}" fill="#7a5230" stroke="#93673d" stroke-width="1.5"/>`;
    // Infield grass
    svg += `<polygon points="${hx},${hy - 6} ${g1.x},${g1.y} ${g2.x},${g2.y} ${g3.x},${g3.y}" fill="#1c5b34"/>`;
    // Foul lines
    svg += `<line x1="${hx}" y1="${hy}" x2="${lf.x}" y2="${lf.y}" stroke="#dfe8f5" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    svg += `<line x1="${hx}" y1="${hy}" x2="${rf.x}" y2="${rf.y}" stroke="#dfe8f5" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    // Bases
    for (const bp of [b1, b2, b3]) {
        svg += `<rect x="${bp.x - 4}" y="${bp.y - 4}" width="8" height="8" transform="rotate(45 ${bp.x} ${bp.y})" fill="#f4f7fb" stroke="#20303f"/>`;
    }
    // Mound
    svg += `<circle cx="${mound.x}" cy="${mound.y}" r="7" fill="#93673d" stroke="#b07f4c"/>`;

    // Batted balls
    for (const p of sp.points) {
        const col = SPRAY_COLORS[p.cat] || '#99ddbb';
        const r = p.contact === 'hard' ? 5.5 : (p.contact === 'soft' ? 3.5 : 4.5);
        const op = p.exact ? 0.95 : 0.6;
        const label = `${p.label} — ${p.batter}${p.bb_type ? ` (${p.bb_type})` : ''}`;
        svg += `<circle cx="${p.x * W}" cy="${p.y * H}" r="${r}" fill="${col}" fill-opacity="${op}" stroke="#07101c" stroke-width="0.8"><title>${label}</title></circle>`;
    }

    svg += '</svg>';
    return svg;
}

/**
 * Pitch zone grid for scorer UI (interactive)
 */
export function buildPitchZoneGrid(pitches, onZoneClick) {
    const zones = [1,2,3,4,5,6,7,8,9];
    const counts = {};
    for (const p of pitches) {
        if (!counts[p.zone]) counts[p.zone] = { total: 0, strikes: 0, balls: 0, swings: 0 };
        counts[p.zone].total++;
        if (p.is_strike) counts[p.zone].strikes++;
        if (p.is_swing) counts[p.zone].swings++;
        if (p.result === 'B') counts[p.zone].balls++;
    }

    let html = '<div class="pitch-grid">';
    for (const zn of zones) {
        const c = counts[zn] || { total: 0, strikes: 0, balls: 0, swings: 0 };
        const cls = c.total ? (c.strikes > c.balls ? 'strike' : 'ball') : '';
        html += `<button class="pitch-zone ${cls}" data-zone="${zn}" title="Zone ${zn}: ${c.total} pitches (${c.strikes}K/${c.balls}B)">
            <span>${zn}</span>
            ${c.total ? `<small>${c.strikes}K/${c.balls}B</small>` : ''}
        </button>`;
    }
    html += '</div>';
    return html;
}

/**
 * Chase zones for scorer UI
 */
export function buildChaseZones(pitches) {
    const zones = [11, 12, 13, 14];
    const counts = {};
    for (const p of pitches) {
        if (OUT_ZONE.has(p.zone)) {
            if (!counts[p.zone]) counts[p.zone] = { total: 0, swings: 0 };
            counts[p.zone].total++;
            if (p.is_swing) counts[p.zone].swings++;
        }
    }
    let html = '<div class="chase-zones">';
    for (const zn of zones) {
        const c = counts[zn] || { total: 0, swings: 0 };
        html += `<div class="chase-zone" data-zone="${zn}" title="Chase ${zn}: ${c.total} pitches">
            ${c.total ? `<span>${c.total} (${c.swings} swings)</span>` : zn}
        </div>`;
    }
    html += '</div>';
    return html;
}

// Re-export constants
export const OUT_ZONE = new Set([11, 12, 13, 14]);