/**
 * Import/Export: JSON + ZIP backup/restore
 */

export async function exportSession(api) {
    const data = await api.exportAll();
    const manifest = {
        format: 'diamondscorer-web',
        version: 2,
        exported_at: new Date().toISOString(),
        counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]))
    };
    const payload = { manifest, tables: data };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diamondscorer_${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

export async function exportSessionZIP(api) {
    const data = await api.exportAll();
    const manifest = {
        format: 'diamondscorer-web',
        version: 2,
        exported_at: new Date().toISOString(),
        counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]))
    };
    const payload = { manifest, tables: data };
    const json = JSON.stringify(payload, null, 2);

    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('session.json', json);

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diamondscorer_${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

export async function importSession(api, file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                let payload;
                if (file.name.endsWith('.zip')) {
                    const zip = await JSZip.loadAsync(text);
                    if (!zip.file('session.json')) throw new Error('Invalid session file (session.json missing)');
                    payload = JSON.parse(await zip.file('session.json').async('text'));
                } else {
                    payload = JSON.parse(text);
                }

                const tables = payload.tables || payload;
                if (!tables || typeof tables !== 'object') throw new Error('Invalid format: no tables section');

                const order = [
                    'categories', 'tourneys', 'teams', 'players',
                    'tourney_teams', 'games', 'game_lineups', 'game_events', 'game_pitches'
                ];

                // Clear in reverse order
                for (const table of [...order].reverse()) {
                    if (tables[table]?.length) {
                        await api.supabase.from(table).delete().neq('id', 0);
                    }
                }

                // Insert in order
                for (const table of order) {
                    if (tables[table]?.length) {
                        const { error } = await api.supabase.from(table).insert(tables[table]);
                        if (error) throw error;
                    }
                }

                resolve({ ok: true, loaded: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        if (file.name.endsWith('.zip')) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
    });
}

export function downloadTemplate(table) {
    const templates = {
        categories: [{ name: 'Toddlers', min_age: 4, max_age: 5 }],
        tourneys: [{ name: 'Torneo Ejemplo', abbrev: 'TE', category_id: 1, is_event: false, year: 2024 }],
        teams: [{ name: 'Equipo A', abbrev: 'EQA', place: 'Ciudad', category_id: 1 }],
        players: [{ first_name: 'Juan', last_name: 'Pérez', position: 'P', bats: 'R', throws: 'R', dob: '2010-01-15', team_id: 1, jersey_number: 1 }]
    };
    const data = templates[table] || [];
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table}_template.json`;
    a.click();
    URL.revokeObjectURL(url);
}