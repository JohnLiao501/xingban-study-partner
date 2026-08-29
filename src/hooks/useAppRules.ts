import { useEffect, useState } from "react";
import type { AppRule, SaveAppRuleInput } from "../../shared/rules";

function browserRuleId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `rule-${Date.now()}`;
}

export function useAppRules() {
  const [rules, setRules] = useState<AppRule[]>([]);
  const [error, setError] = useState<string>();
  const desktopApi = window.studyPartner;

  const refresh = async (): Promise<void> => {
    if (!desktopApi) return;
    try {
      setRules(await desktopApi.listAppRules());
      setError(undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "RULES_LOAD_FAILED");
    }
  };

  useEffect(() => {
    void refresh();
  }, [desktopApi]);

  const save = async (input: SaveAppRuleInput): Promise<void> => {
    try {
      const saved = desktopApi ? await desktopApi.saveAppRule(input) : {
        ...input,
        id: input.id ?? browserRuleId(),
        pattern: input.pattern.trim(),
        createdAt: new Date().toISOString(),
      };
      setRules((current) => [saved, ...current.filter((rule) => rule.id !== saved.id)]);
      setError(undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "RULE_SAVE_FAILED");
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      if (desktopApi) await desktopApi.deleteAppRule(id);
      setRules((current) => current.filter((rule) => rule.id !== id));
      setError(undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "RULE_DELETE_FAILED");
    }
  };

  return { rules, error, refresh, save, remove };
}
