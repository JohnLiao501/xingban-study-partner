export const RULE_MATCH_TYPES = ["process", "window-title"] as const;
export const RULE_DECISIONS = ["allow", "block"] as const;

export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];
export type RuleDecision = (typeof RULE_DECISIONS)[number];

export interface AppRule {
  id: string;
  matchType: RuleMatchType;
  pattern: string;
  decision: RuleDecision;
  enabled: boolean;
  createdAt: string;
}

export interface SaveAppRuleInput {
  id?: string;
  matchType: RuleMatchType;
  pattern: string;
  decision: RuleDecision;
  enabled: boolean;
}

export interface AppRuleApi {
  listAppRules: () => Promise<AppRule[]>;
  saveAppRule: (input: SaveAppRuleInput) => Promise<AppRule>;
  deleteAppRule: (id: string) => Promise<void>;
}
