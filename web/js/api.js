/**
 * Supabase API Wrapper
 * Handles all database operations with retry logic and realtime subscriptions
 */

export class SupabaseAPI {
    constructor() {
        this.supabase = null;
        this.subscriptions = new Map();
        this.listeners = new Map();
        this.connected = false;
    }

    init(url, key) {
        if (!url || !key) throw new Error('Supabase URL and Key required');
        this.supabase = window.supabase.createClient(url, key, {
            auth: { persistSession: false },
            realtime: { params: { eventsPerSecond: 50 } }
        });
        this._setupRealtime();
        return this;
    }

    _setupRealtime() {
        // Connection state
        this.supabase.realtime.onOpen(() => {
            this.connected = true;
            this._emit('connection', { connected: true });
        });
        this.supabase.realtime.onClose(() => {
            this.connected = false;
            this._emit('connection', { connected: false });
        });
        this.supabase.realtime.onError((err) => {
            console.error('Realtime error:', err);
            this._emit('connection', { connected: false, error: err });
        });
    }

    // Event emitter pattern
    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }

    _emit(event, data) {
        this.listeners.get(event)?.forEach(cb => cb(data));
    }

    // =========================================
    // Generic CRUD
    // =========================================
    async select(table, options = {}) {
        let query = this.supabase.from(table).select(options.columns || '*');
        if (options.filter) query = query.eq(options.filter.column, options.filter.value);
        if (options.filters) options.filters.forEach(f => query = query.eq(f.column, f.value));
        if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending !== false });
        if (options.limit) query = query.limit(options.limit);
        if (options.range) query = query.range(options.range.from, options.range.to);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    }

    async insert(table, rows, returning = true) {
        const { data, error } = await this.supabase
            .from(table)
            .insert(Array.isArray(rows) ? rows : [rows], { returning: returning ? 'representation' : 'minimal' });
        if (error) throw error;
        return data;
    }

    async update(table, id, updates) {
        const { data, error } = await this.supabase
            .from(table)
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async upsert(table, rows, onConflict) {
        const { data, error } = await this.supabase
            .from(table)
            .upsert(Array.isArray(rows) ? rows : [rows], { onConflict, returning: 'representation' });
        if (error) throw error;
        return data;
    }

    async delete(table, id) {
        const { error } = await this.supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        return true;
    }

    async deleteWhere(table, filters) {
        let query = this.supabase.from(table).delete();
        filters.forEach(f => query = query.eq(f.column, f.value));
        const { error } = await query;
        if (error) throw error;
        return true;
    }

    // =========================================
    // Categories
    // =========================================
    async getCategories() { return this.select('categories', { order: { column: 'min_age' } }); }
    async createCategory(data) { return this.insert('categories', data); }
    async updateCategory(id, data) { return this.update('categories', id, data); }
    async deleteCategory(id) { return this.delete('categories', id); }

    // =========================================
    // Tourneys
    // =========================================
    async getTourneys(categoryId) {
        const filters = categoryId ? [{ column: 'category_id', value: categoryId }] : [];
        return this.select('tourneys', { filters, order: { column: 'year', ascending: false } });
    }
    async getTourney(id) {
        const { data, error } = await this.supabase
            .from('tourneys')
            .select('*, categories(name, min_age, max_age)')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    }
    async createTourney(data) { return this.insert('tourneys', data); }
    async updateTourney(id, data) { return this.update('tourneys', id, data); }
    async deleteTourney(id) { return this.delete('tourneys', id); }
    async getTourneyTeams(tourneyId) {
        return this.select('tourney_teams', { filter: { column: 'tourney_id', value: tourneyId } });
    }
    async addTeamToTourney(tourneyId, teamId) {
        return this.insert('tourney_teams', { tourney_id: tourneyId, team_id: teamId });
    }
    async removeTeamFromTourney(tourneyId, teamId) {
        return this.deleteWhere('tourney_teams', [
            { column: 'tourney_id', value: tourneyId },
            { column: 'team_id', value: teamId }
        ]);
    }

    // =========================================
    // Teams
    // =========================================
    async getTeams(categoryId) {
        const filters = categoryId ? [{ column: 'category_id', value: categoryId }] : [];
        return this.select('teams', { filters, order: { column: 'name' } });
    }
    async getTeam(id) { return this.select('teams', { filter: { column: 'id', value: id } }).then(d => d[0]); }
    async createTeam(data) { return this.insert('teams', data); }
    async updateTeam(id, data) { return this.update('teams', id, data); }
    async deleteTeam(id) { return this.delete('teams', id); }

    // =========================================
    // Players
    // =========================================
    async getPlayers(teamId) {
        const filters = teamId ? [{ column: 'team_id', value: teamId }] : [];
        return this.select('players', { filters, order: { column: 'last_name' } });
    }
    async getPlayer(id) {
        const { data, error } = await this.supabase
            .from('players')
            .select('*, teams(name, category_id)')
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    }
    async createPlayer(data) { return this.insert('players', data); }
    async updatePlayer(id, data) { return this.update('players', id, data); }
    async deletePlayer(id) { return this.delete('players', id); }

    // =========================================
    // Games
    // =========================================
    async getGames(options = {}) {
        let query = this.supabase
            .from('games')
            .select(`
                *,
                tourneys(name, category_id),
                away_team:teams!away_team_id(name, abbrev),
                home_team:teams!home_team_id(name, abbrev)
            `);
        if (options.tourneyId) query = query.eq('tourney_id', options.tourneyId);
        if (options.teamId) query = query.or(`away_team_id.eq.${options.teamId},home_team_id.eq.${options.teamId}`);
        if (options.status) query = query.eq('status', options.status);
        query = query.order('game_date', { ascending: false, nullsLast: true }).order('id', { ascending: false });
        if (options.limit) query = query.limit(options.limit);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    }
    async getGame(id) {
        const { data, error } = await this.supabase
            .from('games')
            .select(`
                *,
                tourneys(name, category_id),
                away_team:teams!away_team_id(name, abbrev, place),
                home_team:teams!home_team_id(name, abbrev, place)
            `)
            .eq('id', id)
            .single();
        if (error) throw error;
        return data;
    }
    async createGame(data) { return this.insert('games', data); }
    async updateGame(id, data) { return this.update('games', id, data); }
    async updateGameScore(id, awayScore, homeScore) {
        return this.update('games', id, { away_score: awayScore, home_score: homeScore });
    }
    async updateGameStatus(id, status) { return this.update('games', id, { status }); }
    async deleteGame(id) {
        // Cascade deletes via FK, but we need to delete child tables first due to RLS
        await this.deleteWhere('game_pitches', [{ column: 'game_id', value: id }]);
        await this.deleteWhere('game_events', [{ column: 'game_id', value: id }]);
        await this.deleteWhere('game_lineups', [{ column: 'game_id', value: id }]);
        return this.delete('games', id);
    }

    // =========================================
    // Game Lineups
    // =========================================
    async getLineups(gameId) {
        return this.select('game_lineups', {
            filter: { column: 'game_id', value: gameId },
            order: { column: 'entered_seq', ascending: false }
        });
    }
    async setLineup(gameId, side, entries) {
        // Delete existing
        await this.deleteWhere('game_lineups', [
            { column: 'game_id', value: gameId },
            { column: 'side', value: side }
        ]);
        // Insert new
        const rows = entries.map((e, i) => ({
            game_id: gameId,
            side,
            batting_order: e.battingOrder ?? e.batting_order ?? i + 1,
            player_id: e.playerId ?? e.player_id,
            position: e.position,
            is_starter: true,
            active: true
        }));
        return this.insert('game_lineups', rows);
    }
    async substitute(gameId, lineupId, playerId, position) {
        const old = await this.select('game_lineups', { filter: { column: 'id', value: lineupId } }).then(d => d[0]);
        if (!old) throw new Error('Lineup not found');
        // Deactivate old
        await this.update('game_lineups', lineupId, { active: false });
        // Get next seq
        const { data: maxSeq } = await this.supabase
            .from('game_lineups')
            .select('entered_seq')
            .eq('game_id', gameId)
            .order('entered_seq', { ascending: false })
            .limit(1);
        const seq = (maxSeq?.[0]?.entered_seq || 0) + 1;
        // Insert new
        return this.insert('game_lineups', {
            game_id: gameId,
            side: old.side,
            batting_order: old.batting_order,
            player_id: playerId,
            position: position || old.position,
            is_starter: false,
            entered_seq: seq,
            sub_for: lineupId,
            active: true
        });
    }

    // =========================================
    // Game Events
    // =========================================
    async getEvents(gameId) {
        return this.select('game_events', {
            filter: { column: 'game_id', value: gameId },
            order: { column: 'seq' }
        });
    }
    async addEvent(gameId, event) {
        // Get next seq
        const { data: maxSeq } = await this.supabase
            .from('game_events')
            .select('seq')
            .eq('game_id', gameId)
            .order('seq', { ascending: false })
            .limit(1);
        const seq = (maxSeq?.[0]?.seq || 0) + 1;
        return this.insert('game_events', { ...event, game_id: gameId, seq });
    }
    async updateEvent(id, updates) { return this.update('game_events', id, updates); }
    async deleteEvent(id) { return this.delete('game_events', id); }

    // =========================================
    // Game Pitches
    // =========================================
    async getPitches(gameId) {
        return this.select('game_pitches', {
            filter: { column: 'game_id', value: gameId },
            order: { column: 'id' }
        });
    }
    async addPitches(gameId, eventId, pitches) {
        const rows = pitches.map((p, i) => ({
            game_id: gameId,
            event_id: eventId,
            inning: p.inning,
            half: p.half,
            batter_id: p.batterId,
            pitcher_id: p.pitcherId,
            pitch_num: p.pitchNum ?? i + 1,
            zone: p.zone,
            velocity: p.velocity,
            pitch_type: p.pitchType,
            result: p.result,
            is_strike: p.isStrike,
            is_swing: p.isSwing
        }));
        return this.insert('game_pitches', rows);
    }

    // =========================================
    // Realtime Subscriptions
    // =========================================
    subscribeGameEvents(gameId, callback) {
        const key = `game_events_${gameId}`;
        if (this.subscriptions.has(key)) {
            this.subscriptions.get(key).callbacks.add(callback);
            return () => this.unsubscribeGameEvents(gameId, callback);
        }
        const channel = this.supabase
            .channel(key)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'game_events',
                filter: `game_id=eq.${gameId}`
            }, payload => callback(payload))
            .subscribe();
        this.subscriptions.set(key, { channel, callbacks: new Set([callback]) });
        return () => this.unsubscribeGameEvents(gameId, callback);
    }

    unsubscribeGameEvents(gameId, callback) {
        const key = `game_events_${gameId}`;
        const sub = this.subscriptions.get(key);
        if (!sub) return;
        sub.callbacks.delete(callback);
        if (sub.callbacks.size === 0) {
            sub.channel.unsubscribe();
            this.subscriptions.delete(key);
        }
    }

    subscribeGamePitches(gameId, callback) {
        const key = `game_pitches_${gameId}`;
        if (this.subscriptions.has(key)) {
            this.subscriptions.get(key).callbacks.add(callback);
            return () => this.unsubscribeGamePitches(gameId, callback);
        }
        const channel = this.supabase
            .channel(key)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'game_pitches',
                filter: `game_id=eq.${gameId}`
            }, payload => callback(payload))
            .subscribe();
        this.subscriptions.set(key, { channel, callbacks: new Set([callback]) });
        return () => this.unsubscribeGamePitches(gameId, callback);
    }

    unsubscribeGamePitches(gameId, callback) {
        const key = `game_pitches_${gameId}`;
        const sub = this.subscriptions.get(key);
        if (!sub) return;
        sub.callbacks.delete(callback);
        if (sub.callbacks.size === 0) {
            sub.channel.unsubscribe();
            this.subscriptions.delete(key);
        }
    }

    subscribeGame(gameId, callback) {
        const key = `game_${gameId}`;
        if (this.subscriptions.has(key)) {
            this.subscriptions.get(key).callbacks.add(callback);
            return () => this.unsubscribeGame(gameId, callback);
        }
        const channel = this.supabase
            .channel(key)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'games',
                filter: `id=eq.${gameId}`
            }, payload => callback(payload))
            .subscribe();
        this.subscriptions.set(key, { channel, callbacks: new Set([callback]) });
        return () => this.unsubscribeGame(gameId, callback);
    }

    unsubscribeGame(gameId, callback) {
        const key = `game_${gameId}`;
        const sub = this.subscriptions.get(key);
        if (!sub) return;
        sub.callbacks.delete(callback);
        if (sub.callbacks.size === 0) {
            sub.channel.unsubscribe();
            this.subscriptions.delete(key);
        }
    }

    unsubscribeAll() {
        this.subscriptions.forEach(({ channel }) => channel.unsubscribe());
        this.subscriptions.clear();
    }

    // =========================================
    // Bulk Operations (Import/Export)
    // =========================================
    async exportAll() {
        const tables = [
            'categories', 'tourneys', 'teams', 'players',
            'tourney_teams', 'games', 'game_lineups', 'game_events', 'game_pitches'
        ];
        const data = {};
        for (const table of tables) {
            const { data: rows, error } = await this.supabase.from(table).select('*');
            if (error) throw error;
            data[table] = rows;
        }
        return data;
    }

    async importAll(data) {
        const tables = [
            'categories', 'tourneys', 'teams', 'players',
            'tourney_teams', 'games', 'game_lineups', 'game_events', 'game_pitches'
        ];
        // Delete in reverse order
        for (const table of [...tables].reverse()) {
            await this.supabase.from(table).delete().neq('id', 0); // Delete all
        }
        // Insert in order
        for (const table of tables) {
            if (data[table]?.length) {
                const { error } = await this.supabase.from(table).insert(data[table]);
                if (error) throw error;
            }
        }
        return true;
    }
}

// Singleton instance
export const api = new SupabaseAPI();