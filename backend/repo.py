"""Data-access layer: CRUD helpers for the Utilities module.

Each function returns plain dicts (JSON-serialisable) so the API layer can hand
them straight to the frontend. Kept deliberately explicit rather than a generic
ORM so the SQL stays readable and easy to extend as later phases add games,
plate appearances and pitches.
"""
from __future__ import annotations

import json
from typing import Any

from .db import get_conn, gen_public_id


def _rows(cur) -> list[dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


def _one(cur) -> dict[str, Any] | None:
    r = cur.fetchone()
    return dict(r) if r else None


# ---------------------------------------------------------------------------
# Leagues
# ---------------------------------------------------------------------------
def list_leagues() -> list[dict]:
    c = get_conn()
    return _rows(c.execute(
        "SELECT l.*, "
        "(SELECT COUNT(*) FROM seasons s WHERE s.league_id = l.id) AS season_count "
        "FROM leagues l ORDER BY l.name COLLATE NOCASE"
    ))


def get_league(league_id: int) -> dict | None:
    c = get_conn()
    return _one(c.execute("SELECT * FROM leagues WHERE id = ?", (league_id,)))


def create_league(data: dict) -> dict:
    c = get_conn()
    cur = c.execute(
        "INSERT INTO leagues (name, abbrev, level, notes) VALUES (?,?,?,?)",
        (data.get("name"), data.get("abbrev"), data.get("level"), data.get("notes")),
    )
    c.commit()
    return get_league(cur.lastrowid)


def update_league(league_id: int, data: dict) -> dict | None:
    c = get_conn()
    c.execute(
        "UPDATE leagues SET name=?, abbrev=?, level=?, notes=? WHERE id=?",
        (data.get("name"), data.get("abbrev"), data.get("level"), data.get("notes"), league_id),
    )
    c.commit()
    return get_league(league_id)


def delete_league(league_id: int) -> None:
    c = get_conn()
    c.execute("DELETE FROM leagues WHERE id = ?", (league_id,))
    c.commit()


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------
def list_seasons(league_id: int | None = None) -> list[dict]:
    c = get_conn()
    sql = (
        "SELECT s.*, l.name AS league_name, "
        "(SELECT COUNT(*) FROM season_teams st WHERE st.season_id = s.id) AS team_count "
        "FROM seasons s JOIN leagues l ON l.id = s.league_id"
    )
    params: tuple = ()
    if league_id is not None:
        sql += " WHERE s.league_id = ?"
        params = (league_id,)
    sql += " ORDER BY s.year DESC, s.name"
    return _rows(c.execute(sql, params))


def get_season(season_id: int) -> dict | None:
    c = get_conn()
    return _one(c.execute(
        "SELECT s.*, l.name AS league_name FROM seasons s "
        "JOIN leagues l ON l.id = s.league_id WHERE s.id = ?", (season_id,)))


def create_season(data: dict) -> dict:
    c = get_conn()
    cur = c.execute(
        "INSERT INTO seasons (league_id, name, year, start_date, end_date, notes) "
        "VALUES (?,?,?,?,?,?)",
        (data.get("league_id"), data.get("name"), data.get("year"),
         data.get("start_date"), data.get("end_date"), data.get("notes")),
    )
    c.commit()
    return get_season(cur.lastrowid)


def update_season(season_id: int, data: dict) -> dict | None:
    c = get_conn()
    c.execute(
        "UPDATE seasons SET league_id=?, name=?, year=?, start_date=?, end_date=?, notes=? "
        "WHERE id=?",
        (data.get("league_id"), data.get("name"), data.get("year"),
         data.get("start_date"), data.get("end_date"), data.get("notes"), season_id),
    )
    c.commit()
    return get_season(season_id)


def delete_season(season_id: int) -> None:
    c = get_conn()
    c.execute("DELETE FROM seasons WHERE id = ?", (season_id,))
    c.commit()


# ---------------------------------------------------------------------------
# Teams (global entities)
# ---------------------------------------------------------------------------
def list_teams() -> list[dict]:
    c = get_conn()
    return _rows(c.execute("SELECT * FROM teams ORDER BY name COLLATE NOCASE"))


def get_team(team_id: int) -> dict | None:
    c = get_conn()
    return _one(c.execute("SELECT * FROM teams WHERE id = ?", (team_id,)))


def create_team(data: dict) -> dict:
    c = get_conn()
    cur = c.execute(
        "INSERT INTO teams (name, abbrev, city, color, notes) VALUES (?,?,?,?,?)",
        (data.get("name"), data.get("abbrev"), data.get("city"),
         data.get("color"), data.get("notes")),
    )
    c.commit()
    return get_team(cur.lastrowid)


def update_team(team_id: int, data: dict) -> dict | None:
    c = get_conn()
    c.execute(
        "UPDATE teams SET name=?, abbrev=?, city=?, color=?, notes=? WHERE id=?",
        (data.get("name"), data.get("abbrev"), data.get("city"),
         data.get("color"), data.get("notes"), team_id),
    )
    c.commit()
    return get_team(team_id)


def delete_team(team_id: int) -> None:
    c = get_conn()
    c.execute("DELETE FROM teams WHERE id = ?", (team_id,))
    c.commit()


# ---------------------------------------------------------------------------
# Players (global entities with persistent identity across leagues/seasons)
# ---------------------------------------------------------------------------
def list_players() -> list[dict]:
    c = get_conn()
    # ``team_name`` is the player's most recent team (by season year), so the
    # Players tab can show a Team column. NULL when never rostered. Ordered
    # alphabetically by the displayed full name (case-insensitive).
    return _rows(c.execute(
        "SELECT p.*, (TRIM(p.first_name || ' ' || p.last_name)) AS full_name, "
        "(SELECT t.name FROM roster r "
        "   JOIN teams t ON t.id = r.team_id "
        "   JOIN seasons s ON s.id = r.season_id "
        "   WHERE r.player_id = p.id "
        "   ORDER BY COALESCE(s.year, 0) DESC, s.id DESC LIMIT 1) AS team_name "
        "FROM players p "
        "ORDER BY full_name COLLATE NOCASE"))


def get_player(player_id: int) -> dict | None:
    c = get_conn()
    return _one(c.execute(
        "SELECT p.*, (TRIM(p.first_name || ' ' || p.last_name)) AS full_name "
        "FROM players p WHERE id = ?", (player_id,)))


def create_player(data: dict) -> dict:
    c = get_conn()
    existing = {
        r["public_id"]
        for r in c.execute(
            "SELECT public_id FROM players WHERE public_id IS NOT NULL"
        ).fetchall()
    }
    public_id = gen_public_id(existing)
    cur = c.execute(
        "INSERT INTO players (first_name, last_name, bats, throws, primary_position, "
        "public_id, birthdate, height_cm, weight_kg, notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (data.get("first_name"), data.get("last_name"), data.get("bats"),
         data.get("throws"), data.get("primary_position"), public_id,
         data.get("birthdate"), data.get("height_cm"), data.get("weight_kg"),
         data.get("notes")),
    )
    c.commit()
    return get_player(cur.lastrowid)


def update_player(player_id: int, data: dict) -> dict | None:
    c = get_conn()
    c.execute(
        "UPDATE players SET first_name=?, last_name=?, bats=?, throws=?, "
        "primary_position=?, birthdate=?, height_cm=?, weight_kg=?, notes=? WHERE id=?",
        (data.get("first_name"), data.get("last_name"), data.get("bats"),
         data.get("throws"), data.get("primary_position"), data.get("birthdate"),
         data.get("height_cm"), data.get("weight_kg"), data.get("notes"), player_id),
    )
    c.commit()
    return get_player(player_id)


def delete_player(player_id: int) -> None:
    c = get_conn()
    c.execute("DELETE FROM players WHERE id = ?", (player_id,))
    c.commit()


def merge_players(target_id: int, source_ids: list[int],
                  profile: dict | None = None) -> dict | None:
    """Merge one or more source players INTO a surviving target player.

    Every reference to a source player is reassigned to the target: rosters,
    game lineups, game events (batter/pitcher/catcher/runner/error_on plus the
    multi-error ``errors_json`` array), pitches, and the game W/L/Save pitcher
    attributions. The now-orphaned source player rows are then deleted. If
    ``profile`` is given, the surviving target's attributes are updated with it.
    This is irreversible.
    """
    c = get_conn()
    target_id = int(target_id)
    sources = [int(s) for s in (source_ids or []) if int(s) != target_id]
    sources = list(dict.fromkeys(sources))  # dedupe, preserve order
    if get_player(target_id) is None:
        return None
    if not sources:
        if profile:
            update_player(target_id, profile)
        return get_player(target_id)

    qmarks = ",".join("?" for _ in sources)
    params = (target_id, *sources)

    # Game W/L/Save pitcher attributions.
    for col in ("win_pitcher_id", "loss_pitcher_id", "save_pitcher_id"):
        c.execute(f"UPDATE games SET {col}=? WHERE {col} IN ({qmarks})", params)

    # Lineups.
    c.execute(
        f"UPDATE game_lineups SET player_id=? WHERE player_id IN ({qmarks})",
        params)

    # Event participant + single-error columns.
    for col in ("batter_id", "pitcher_id", "catcher_id", "runner_id", "error_on"):
        c.execute(
            f"UPDATE game_events SET {col}=? WHERE {col} IN ({qmarks})", params)

    # Pitch participant columns.
    for col in ("batter_id", "pitcher_id"):
        c.execute(
            f"UPDATE game_pitches SET {col}=? WHERE {col} IN ({qmarks})", params)

    # Multi-error JSON arrays: swap any source id for the target id.
    srcset = set(sources)
    rows = c.execute(
        "SELECT id, errors_json FROM game_events "
        "WHERE errors_json IS NOT NULL AND errors_json != ''").fetchall()
    for row in rows:
        try:
            ids = json.loads(row["errors_json"])
        except (ValueError, TypeError):
            continue
        if not isinstance(ids, list):
            continue
        changed = False
        new_ids = []
        for v in ids:
            if v in srcset:
                new_ids.append(target_id)
                changed = True
            else:
                new_ids.append(v)
        if changed:
            c.execute("UPDATE game_events SET errors_json=? WHERE id=?",
                      (json.dumps(new_ids), row["id"]))

    # Rosters: a player may be on only one team per season, so never create a
    # duplicate. If the target is already rostered in a season a source
    # occupies, drop the source row; otherwise reassign it to the target.
    rrows = c.execute(
        f"SELECT id, season_id FROM roster WHERE player_id IN ({qmarks})",
        tuple(sources)).fetchall()
    for row in rrows:
        exists = c.execute(
            "SELECT 1 FROM roster WHERE season_id=? AND player_id=? LIMIT 1",
            (row["season_id"], target_id)).fetchone()
        if exists:
            c.execute("DELETE FROM roster WHERE id=?", (row["id"],))
        else:
            c.execute("UPDATE roster SET player_id=? WHERE id=?",
                      (target_id, row["id"]))

    # Remove the merged-away source players.
    c.execute(f"DELETE FROM players WHERE id IN ({qmarks})", tuple(sources))
    c.commit()

    if profile:
        update_player(target_id, profile)
    return get_player(target_id)


# ---------------------------------------------------------------------------
# Season <-> Team participation
# ---------------------------------------------------------------------------
def list_season_teams(season_id: int) -> list[dict]:
    c = get_conn()
    return _rows(c.execute(
        "SELECT t.*, st.id AS link_id FROM season_teams st "
        "JOIN teams t ON t.id = st.team_id WHERE st.season_id = ? ORDER BY t.name",
        (season_id,)))


def add_team_to_season(season_id: int, team_id: int) -> None:
    c = get_conn()
    c.execute(
        "INSERT OR IGNORE INTO season_teams (season_id, team_id) VALUES (?,?)",
        (season_id, team_id))
    c.commit()


def remove_team_from_season(season_id: int, team_id: int) -> None:
    c = get_conn()
    c.execute(
        "DELETE FROM season_teams WHERE season_id = ? AND team_id = ?",
        (season_id, team_id))
    c.commit()


# ---------------------------------------------------------------------------
# Roster (player on a team within a season)
# ---------------------------------------------------------------------------
def list_roster(season_id: int, team_id: int) -> list[dict]:
    c = get_conn()
    return _rows(c.execute(
        "SELECT r.id AS roster_id, r.jersey, r.position, p.* , "
        "(TRIM(p.first_name || ' ' || p.last_name)) AS full_name "
        "FROM roster r JOIN players p ON p.id = r.player_id "
        "WHERE r.season_id = ? AND r.team_id = ? "
        "ORDER BY full_name COLLATE NOCASE", (season_id, team_id)))


def season_player_assignments(season_id: int) -> list[dict]:
    """Every (player, team) pairing already set in a season.

    Used to enforce "one team per player per season" and to let the UI hide
    players who are already rostered on another team in the same season.
    """
    c = get_conn()
    return _rows(c.execute(
        "SELECT r.player_id, r.team_id, t.name AS team_name, "
        "(TRIM(p.first_name || ' ' || p.last_name)) AS full_name "
        "FROM roster r JOIN teams t ON t.id = r.team_id "
        "JOIN players p ON p.id = r.player_id "
        "WHERE r.season_id = ?", (season_id,)))


def add_player_to_roster(season_id: int, team_id: int, data: dict) -> None:
    c = get_conn()
    player_id = data.get("player_id")
    # Phase 9: a player may belong to only ONE team within a given season.
    # Re-adding to the SAME team is allowed (updates jersey/position); adding to
    # a different team in the same season is rejected.
    other = c.execute(
        "SELECT t.name AS team_name FROM roster r JOIN teams t ON t.id = r.team_id "
        "WHERE r.season_id = ? AND r.player_id = ? AND r.team_id != ? LIMIT 1",
        (season_id, player_id, team_id)).fetchone()
    if other is not None:
        raise ValueError(
            f"Player is already on \"{other['team_name']}\" this season. "
            "A player can be rostered on only one team per season.")
    c.execute(
        "INSERT OR REPLACE INTO roster (season_id, team_id, player_id, jersey, position) "
        "VALUES (?,?,?,?,?)",
        (season_id, team_id, player_id, data.get("jersey"), data.get("position")))
    c.commit()


def remove_player_from_roster(roster_id: int) -> None:
    c = get_conn()
    c.execute("DELETE FROM roster WHERE id = ?", (roster_id,))
    c.commit()


def player_history(player_id: int) -> list[dict]:
    """Every league/season/team stint for a player -- proves identity persists."""
    c = get_conn()
    return _rows(c.execute(
        "SELECT r.jersey, r.position, t.name AS team_name, s.name AS season_name, "
        "s.year, l.name AS league_name FROM roster r "
        "JOIN teams t ON t.id = r.team_id "
        "JOIN seasons s ON s.id = r.season_id "
        "JOIN leagues l ON l.id = s.league_id "
        "WHERE r.player_id = ? ORDER BY s.year DESC", (player_id,)))
