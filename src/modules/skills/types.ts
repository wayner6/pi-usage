export interface SkillDescriptor {
  name: string;
}

export interface SkillUsageEvent {
  version: 1;
  skill: string;
  timestamp: string;
}

export interface SkillUsageStats {
  skill: string;
  uses: number;
}
