import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppRule, SaveAppRuleInput } from "../../shared/rules.js";
import type {
  ObservationLabel,
  PartnerProgressSnapshot,
  SessionHistoryEntry,
  SessionSnapshot,
} from "../../shared/session.js";
import type { CreateStructuredObservationParams } from "../inspection/observation.js";

interface SessionRow {
  checkpoint_json: string;
}

interface ProgressRow {
  partner_id: string;
  total_trust: number;
  current_level_id: string;
  last_session_at: string | null;
}

interface HistoryRow {
  id: string;
  partner_id: string;
  pack_version: string;
  scene_id: string;
  goal: string;
  planned_seconds: number;
  focused_seconds: number;
  deviation_count: number;
  phase: "completed" | "aborted" | "interrupted";
  grade: SessionHistoryEntry["grade"];
  trust_gained: number;
  started_at: string;
  ended_at: string;
}

interface AppRuleRow {
  id: string;
  match_type: AppRule["matchType"];
  pattern: string;
  decision: AppRule["decision"];
  enabled: number;
  created_at: string;
}

const TERMINAL_PHASES = ["completed", "aborted", "interrupted"] as const;

export class XingbanDatabase {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  saveSession(snapshot: SessionSnapshot): void {
    const now = new Date().toISOString();
    const outcome = snapshot.outcome;
    this.database.prepare(`
      INSERT INTO sessions (
        id, partner_id, pack_version, scene_id, goal, planned_seconds, phase,
        started_at, ended_at, focused_seconds, uncertain_seconds, distracted_seconds,
        deviation_count, grade, trust_gained, termination_reason, checkpoint_at,
        checkpoint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase,
        ended_at = excluded.ended_at,
        focused_seconds = excluded.focused_seconds,
        uncertain_seconds = excluded.uncertain_seconds,
        distracted_seconds = excluded.distracted_seconds,
        deviation_count = excluded.deviation_count,
        grade = excluded.grade,
        trust_gained = excluded.trust_gained,
        termination_reason = excluded.termination_reason,
        checkpoint_at = excluded.checkpoint_at,
        checkpoint_json = excluded.checkpoint_json
    `).run(
      snapshot.sessionId,
      snapshot.partnerId,
      snapshot.packVersion,
      snapshot.sceneId,
      snapshot.goal,
      snapshot.plannedSeconds,
      snapshot.phase,
      now,
      outcome ? now : null,
      snapshot.focusedSeconds,
      snapshot.uncertainSeconds,
      snapshot.distractedSeconds,
      snapshot.deviationCount,
      outcome?.grade ?? null,
      outcome?.trustGained ?? 0,
      outcome?.mode ?? null,
      now,
      JSON.stringify(snapshot),
    );
  }

  finalizeSession(
    snapshot: SessionSnapshot,
    resolveLevelId: (totalTrust: number) => string,
  ): PartnerProgressSnapshot {
    if (!snapshot.outcome) throw new Error("DB_SESSION_NOT_SETTLED");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.saveSession(snapshot);
      const applied = this.database.prepare(
        "SELECT progress_applied FROM sessions WHERE id = ?",
      ).get(snapshot.sessionId) as { progress_applied: number } | undefined;
      if (!applied) throw new Error("DB_SESSION_NOT_FOUND");

      if (applied.progress_applied === 0 && snapshot.outcome.mode !== "interrupted") {
        const current = this.getPartnerProgress(snapshot.partnerId);
        const totalTrust = current.totalTrust + snapshot.outcome.trustGained;
        const now = new Date().toISOString();
        this.database.prepare(`
          INSERT INTO partner_progress (
            partner_id, total_trust, current_level_id, last_session_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(partner_id) DO UPDATE SET
            total_trust = excluded.total_trust,
            current_level_id = excluded.current_level_id,
            last_session_at = excluded.last_session_at,
            updated_at = excluded.updated_at
        `).run(snapshot.partnerId, totalTrust, resolveLevelId(totalTrust), now, now);
        this.database.prepare(
          "UPDATE sessions SET progress_applied = 1 WHERE id = ?",
        ).run(snapshot.sessionId);
      }
      this.database.exec("COMMIT");
      return this.getPartnerProgress(snapshot.partnerId);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordObservation(snapshot: SessionSnapshot, label: ObservationLabel): void {
    const confirmedDeviation = label === "distracted" ? 1 : 0;
    this.database.prepare(`
      INSERT INTO observations (
        id, session_id, observed_at, label, confidence, source, reason_code,
        app_name, window_title_hash, confirmed_deviation
      ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'fallback', 'manual-preview', NULL, NULL, ?)
    `).run(
      snapshot.sessionId,
      new Date().toISOString(),
      label,
      label === "uncertain" ? 0 : 1,
      confirmedDeviation,
    );
  }

  recordStructuredObservation(params: CreateStructuredObservationParams): void {
    this.database.prepare(`
      INSERT INTO observations (
        id, session_id, observed_at, label, confidence, source, reason_code,
        app_name, window_title_hash, confirmed_deviation
      ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.sessionId,
      params.observedAt ?? new Date().toISOString(),
      params.label,
      params.confidence,
      params.source,
      params.reasonCode,
      params.appName,
      params.windowTitleHash,
      params.confirmedDeviation ? 1 : 0,
    );
  }

  loadRecoverableSession(): SessionSnapshot | null {
    const placeholders = TERMINAL_PHASES.map(() => "?").join(", ");
    const row = this.database.prepare(`
      SELECT checkpoint_json
      FROM sessions
      WHERE phase NOT IN (${placeholders})
      ORDER BY checkpoint_at DESC
      LIMIT 1
    `).get(...TERMINAL_PHASES) as SessionRow | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.checkpoint_json) as SessionSnapshot;
      if (!parsed || typeof parsed.sessionId !== "string" || typeof parsed.phase !== "string") {
        throw new Error("DB_CHECKPOINT_INVALID");
      }
      const safePhase = parsed.phase === "break" ? "break" : "focusing";
      return {
        ...parsed,
        phase: safePhase,
        paused: true,
        reactionKey: safePhase === "break" ? "idle_loop" : "idle_loop",
        recoveredFromCheckpoint: true,
      };
    } catch {
      throw new Error("DB_CHECKPOINT_INVALID");
    }
  }

  listSessionHistory(limit = 50): SessionHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const placeholders = TERMINAL_PHASES.map(() => "?").join(", ");
    const rows = this.database.prepare(`
      SELECT id, partner_id, pack_version, scene_id, goal, planned_seconds,
             focused_seconds, deviation_count, phase, grade, trust_gained,
             started_at, ended_at
      FROM sessions
      WHERE phase IN (${placeholders}) AND ended_at IS NOT NULL
      ORDER BY ended_at DESC, rowid DESC
      LIMIT ?
    `).all(...TERMINAL_PHASES, safeLimit) as unknown as HistoryRow[];
    return rows.map((row) => ({
      sessionId: row.id,
      partnerId: row.partner_id,
      packVersion: row.pack_version,
      sceneId: row.scene_id,
      goal: row.goal,
      plannedSeconds: row.planned_seconds,
      focusedSeconds: row.focused_seconds,
      deviationCount: row.deviation_count,
      phase: row.phase,
      grade: row.grade,
      trustGained: row.trust_gained,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }));
  }

  getPartnerProgress(partnerId: string): PartnerProgressSnapshot {
    const row = this.database.prepare(`
      SELECT partner_id, total_trust, current_level_id, last_session_at
      FROM partner_progress
      WHERE partner_id = ?
    `).get(partnerId) as ProgressRow | undefined;
    return row ? {
      partnerId: row.partner_id,
      totalTrust: row.total_trust,
      currentLevelId: row.current_level_id,
      lastSessionAt: row.last_session_at,
    } : {
      partnerId,
      totalTrust: 0,
      currentLevelId: "initial",
      lastSessionAt: null,
    };
  }

  listAppRules(): AppRule[] {
    const rows = this.database.prepare(`
      SELECT id, match_type, pattern, decision, enabled, created_at
      FROM app_rules
      ORDER BY decision ASC, created_at ASC
    `).all() as unknown as AppRuleRow[];
    return rows.map((row) => ({
      id: row.id,
      matchType: row.match_type,
      pattern: row.pattern,
      decision: row.decision,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    }));
  }

  saveAppRule(input: SaveAppRuleInput): AppRule {
    const pattern = input.pattern.trim();
    if (!pattern || pattern.length > 200) throw new Error("RULE_INVALID_PATTERN");
    if (input.matchType !== "process" && input.matchType !== "window-title") {
      throw new Error("RULE_INVALID_MATCH_TYPE");
    }
    if (input.decision !== "allow" && input.decision !== "block") {
      throw new Error("RULE_INVALID_DECISION");
    }
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO app_rules(id, match_type, pattern, decision, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        match_type = excluded.match_type,
        pattern = excluded.pattern,
        decision = excluded.decision,
        enabled = excluded.enabled
    `).run(id, input.matchType, pattern, input.decision, input.enabled ? 1 : 0, createdAt);
    return this.listAppRules().find((rule) => rule.id === id) as AppRule;
  }

  deleteAppRule(id: string): void {
    const result = this.database.prepare("DELETE FROM app_rules WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error("RULE_NOT_FOUND");
  }

  getAppSetting(key: string): string | null {
    const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as { value_json: string } | undefined;
    return row?.value_json ?? null;
  }

  setAppSetting(key: string, valueJson: string): void {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, valueJson, now);
  }

  deleteAppSetting(key: string): void {
    this.database.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const migration = this.database.prepare(
      "SELECT version FROM schema_migrations WHERE version = 1",
    ).get() as { version: number } | undefined;
    if (migration) return;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE partner_packs (
          partner_id TEXT NOT NULL,
          pack_version TEXT NOT NULL,
          display_name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          distribution TEXT NOT NULL,
          install_path TEXT NOT NULL,
          manifest_hash TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          installed_at TEXT NOT NULL,
          PRIMARY KEY(partner_id, pack_version)
        );

        CREATE TABLE partner_progress (
          partner_id TEXT PRIMARY KEY,
          total_trust INTEGER NOT NULL DEFAULT 0 CHECK(total_trust >= 0),
          current_level_id TEXT NOT NULL,
          last_session_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          partner_id TEXT NOT NULL,
          pack_version TEXT NOT NULL,
          scene_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          planned_seconds INTEGER NOT NULL CHECK(planned_seconds BETWEEN 600 AND 10800),
          phase TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          focused_seconds INTEGER NOT NULL DEFAULT 0,
          uncertain_seconds INTEGER NOT NULL DEFAULT 0,
          distracted_seconds INTEGER NOT NULL DEFAULT 0,
          deviation_count INTEGER NOT NULL DEFAULT 0,
          grade TEXT,
          trust_gained INTEGER NOT NULL DEFAULT 0,
          termination_reason TEXT,
          checkpoint_at TEXT NOT NULL,
          checkpoint_json TEXT NOT NULL,
          progress_applied INTEGER NOT NULL DEFAULT 0 CHECK(progress_applied IN (0, 1))
        );

        CREATE INDEX sessions_history_idx ON sessions(ended_at DESC);
        CREATE INDEX sessions_recovery_idx ON sessions(phase, checkpoint_at DESC);

        CREATE TABLE observations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          observed_at TEXT NOT NULL,
          label TEXT NOT NULL,
          confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
          source TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          app_name TEXT,
          window_title_hash TEXT,
          confirmed_deviation INTEGER NOT NULL CHECK(confirmed_deviation IN (0, 1))
        );

        CREATE TABLE app_rules (
          id TEXT PRIMARY KEY,
          match_type TEXT NOT NULL CHECK(match_type IN ('process', 'window-title')),
          pattern TEXT NOT NULL,
          decision TEXT NOT NULL CHECK(decision IN ('allow', 'block')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          created_at TEXT NOT NULL
        );
      `);
      this.database.prepare(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)",
      ).run(new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw new Error("DB_MIGRATION_FAILED", { cause: error });
    }
  }
}
